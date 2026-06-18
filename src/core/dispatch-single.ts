/**
 * Immediate single-task dispatch (kick / subtask / continuation / recovery),
 * bypassing the 5-minute cycle. Extracted from dispatch.ts. Shares the single
 * withStateLock from dispatch-state and the fire primitives from dispatch-turns.
 */
import { createLogger } from './logger'
import { appendAudit } from './audit'
import { recordUsage } from './usage'
import { getSettings } from './settings'
import { getAppServices } from './app-services'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import { loseRun } from './execution-ledger'
import { buildTaskLessonQuery } from './agent-packages/lesson-retrieval'
import type { DispatchContinuationContext, DispatchRosterAgent } from './dispatch-types'
import {
  withStateLock,
  loadDispatchState,
  saveDispatchState,
  getFailureRecord,
  cooldownForFailure,
  trimDispatched,
} from './dispatch-state'
import { readDispatchColumns, isTaskDispatchEligible, addTaskLog, moveTaskToInProgress, tryAddTaskLog } from './dispatch-board'
import { buildDispatchLessonBlock, buildDispatchAssetBlock } from './dispatch-context-blocks'
import { buildDispatchMessage, buildDecompositionMessage } from './dispatch-prompts'
import { formatDispatchError } from './dispatch-failures'
import { concurrencyGate, deferForBudget, claimDispatchRun, auditDispatchSuppressed, fireDispatchTurn } from './dispatch-turns'
import { dispatchWorkflowTask } from './dispatch-workflow'

const log = createLogger('dispatch-single')

/**
 * Immediately dispatch a single task by ID, bypassing the 5-minute cycle.
 * Used for kick (explicit) and auto-kick (subtask with parentId), dependency
 * continuation, and the session-death recovery ladder.
 */
export async function dispatchSingleTask(
  taskId: string,
  contentDir: string,
  port: number,
  source: 'kick' | 'subtask' | 'continuation' | 'recovery' = 'kick',
  continuation: DispatchContinuationContext = {},
): Promise<void> {
  const settings = getSettings()

  await withStateLock(async () => {
    const columns = await readDispatchColumns()
    const task = columns.todo.find(t => t.id === taskId)
    if (!task) {
      log.debug('dispatchSingleTask: task not in todo, skipping', { taskId })
      return
    }

    const runtime = getAppServices().runtime
    const runtimeAgents = await runtime.agents.list()
    const runtimeAgentIds = new Set(runtimeAgents.map((agent) => agent.id))
    const runtimeRoster: DispatchRosterAgent[] = runtimeAgents.map((agent) => ({
      id: agent.id,
      ...(agent.role ? { role: agent.role } : {}),
    }))
    const mainAgentId = await getRuntimeMainAgentId(runtime)
    const completedTaskIds = new Set([
      ...columns.done.map(t => t.id),
      ...columns.archived.map(t => t.id),
    ])
    const knownTaskIds = new Set(
      Object.values(columns).flatMap((column) => column.map((t) => t.id)),
    )
    const eligibilityTask = source === 'kick' ? { ...task, availableAt: undefined } : task
    const eligibility = isTaskDispatchEligible(eligibilityTask, {
      nowMs: Date.now(),
      runtimeAgentIds,
      completedTaskIds,
      knownTaskIds,
    })
    if (!eligibility.eligible) {
      log.debug('dispatchSingleTask: task not dispatch eligible', { taskId, reason: eligibility.reason })
      return
    }
    if (eligibility.danglingDependency) {
      log.warn('Task dependency target no longer exists; treating as satisfied', { id: taskId, dependsOn: eligibility.danglingDependency })
      await tryAddTaskLog(taskId, 'system', `Dependency task ${eligibility.danglingDependency} no longer exists (likely archived/removed). Treating the dependency as satisfied and dispatching.`)
    }

    const state = loadDispatchState(contentDir)
    if (state.dispatched.includes(taskId)) {
      log.debug('dispatchSingleTask: already dispatched', { taskId })
      return
    }

    // Check failure history (session-death records are ladder-managed and
    // exempt from the generic cooldown/retry caps — see dispatchTasks).
    const failure = getFailureRecord(state.failedDispatches?.[taskId])
    if (failure && !failure.sessionDeath) {
      if (failure.count >= settings.dispatch.maxRetries) {
        log.warn('dispatchSingleTask: task exhausted retries', { taskId, count: failure.count })
        return
      }
      if (Date.now() - failure.lastAttempt < cooldownForFailure(failure, settings)) {
        log.debug('dispatchSingleTask: task in cooldown', { taskId, kind: failure.kind })
        return
      }
    }

    // Workflow-aware dispatch path
    const taskWithWorkflow = task as typeof task & { workflowId?: string }
    if (taskWithWorkflow.workflowId) {
      const dispatchedSet = new Set(state.dispatched)
      const wfStart = Date.now()
      const wfAgent = task.agent ?? mainAgentId
      try {
        await dispatchWorkflowTask(
          { ...taskWithWorkflow, workflowId: taskWithWorkflow.workflowId },
          contentDir, port, dispatchedSet, state, moveTaskToInProgress, addTaskLog, mainAgentId,
        )
        state.dispatched = [...dispatchedSet]
        saveDispatchState(contentDir, state)
        appendAudit(contentDir, 'task.kicked', source, { id: taskId, title: task.title, workflow: true })
        log.info('Single-task dispatch (workflow)', { id: taskId, title: task.title, source })
        recordUsage({
          kind: 'agent',
          name: 'dispatch',
          agent: wfAgent,
          durationMs: Date.now() - wfStart,
          status: 'ok',
          meta: { taskId: task.id, title: task.title, workflow: true, source },
        })
      } catch (err) {
        log.error(`dispatchSingleTask: workflow dispatch failed for "${task.title}"`, err)
        recordUsage({
          kind: 'agent',
          name: 'dispatch',
          agent: wfAgent,
          durationMs: Date.now() - wfStart,
          status: 'error',
          meta: { taskId: task.id, title: task.title, workflow: true, source, error: formatDispatchError(err) },
        })
      }
      return
    }

    // Regular task dispatch
    const targetAgent = task.agent ?? mainAgentId

    const gate = concurrencyGate(targetAgent, settings)
    if (gate) {
      if (source === 'recovery') {
        // The "immediate" ladder re-dispatch degrades to next-cycle pickup —
        // make that observable instead of a silent debug line.
        log.warn('Ladder recovery dispatch deferred by concurrency gate; next cycle will retry', { taskId, agent: targetAgent, gate })
        await tryAddTaskLog(taskId, 'system', `Recovery re-dispatch deferred (${gate}); the next dispatch cycle will retry.`)
      } else {
        log.debug('dispatchSingleTask: deferred by concurrency gate', { taskId, agent: targetAgent, gate })
      }
      return
    }

    const lessonBlock = await buildDispatchLessonBlock({
      contentDir,
      taskId: task.id,
      title: task.title,
      agentId: targetAgent,
      query: buildTaskLessonQuery(task),
    })
    const assetsBlock = await buildDispatchAssetBlock(task.id)
    const recovery = failure?.sessionDeath
    const message = recovery?.stage === 'decomposition'
      ? buildDecompositionMessage(task, targetAgent, recovery)
      : buildDispatchMessage(task, targetAgent, contentDir, mainAgentId, lessonBlock, continuation, recovery, runtimeRoster, assetsBlock)
    const dispatchStart = Date.now()
    const initialLogCount = task.log?.length ?? 0

    // Spend ceiling — defer (leave in todo) when a budget cap is hit.
    if (await deferForBudget(targetAgent, contentDir)) {
      log.debug('Single-task dispatch deferred by budget gate', { id: task.id, agent: targetAgent, source })
      return
    }

    // Claim first — the ledger row is the lock (a kick racing the cycle or
    // another process fails here, before any side effect).
    const claim = claimDispatchRun(task.id, targetAgent)
    if (!claim.claimed) {
      auditDispatchSuppressed(contentDir, task, targetAgent, claim.liveRunId, 'single')
      return
    }

    const threadId = claim.runId
    try {
      // Move to inProgress BEFORE sending message to eliminate race condition
      await moveTaskToInProgress(task.id, targetAgent)

      state.dispatched.push(task.id)
      trimDispatched(state, settings.dispatch.maxDispatched)
      saveDispatchState(contentDir, state)
    } catch (err) {
      // A claim whose turn will never fire must be released, or the task is
      // locked until the watchdog/boot sweep notices (mirrors the cycle's
      // per-task guard).
      try {
        loseRun(threadId, 'dispatch-prep-failed')
      } catch (releaseErr) {
        log.error('Failed to release claim after prep failure', releaseErr, { threadId })
      }
      throw err
    }

    // Internal move folded into task.dispatched — one audit row per dispatch.
    appendAudit(contentDir, 'task.dispatched', targetAgent, { id: task.id, title: task.title, threadId, from: 'todo', to: 'inProgress' })
    if (source !== 'continuation') {
      appendAudit(contentDir, 'task.kicked', source, { id: task.id, title: task.title })
    }
    log.info('Single-task dispatch', { id: task.id, title: task.title, agent: targetAgent, source, threadId })
    fireDispatchTurn({
      marker: task.id,
      task,
      targetAgent,
      threadId,
      message,
      contentDir,
      port,
      initialLogCount,
      logPrefix: 'Immediate dispatch failed',
      dispatchKind: 'regular',
      isRecovery: source === 'recovery',
      onSettled: (outcome, err) => {
        recordUsage({
          kind: 'agent',
          name: 'dispatch',
          agent: targetAgent,
          durationMs: Date.now() - dispatchStart,
          status: outcome,
          meta: {
            taskId: task.id,
            title: task.title,
            source,
            ...(err ? { error: formatDispatchError(err) } : {}),
          },
        })
      },
    })
  })
}
