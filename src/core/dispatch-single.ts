/**
 * Immediate single-task dispatch (kick / subtask / continuation / recovery),
 * bypassing the 5-minute cycle. Extracted from dispatch.ts. Shares the single
 * withStateLock from dispatch-state and the fire primitives from dispatch-turns.
 */
import { createLogger } from './logger'
import { appendAudit } from './audit'
import { recordUsage } from './usage'
import { getSettings } from './settings'
import { getAppServices } from './app-services-store'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import { loseRun } from './execution-ledger'
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
import { formatDispatchError } from './dispatch-failures'
import { concurrencyGate, deferForBudget, fireDispatchTurn, resolveDispatchRouting } from './dispatch-turns'
import { prepareRegularDispatch } from './dispatch-prepare'
import { deferForMissingBrand } from './dispatch-context-blocks'
import { dispatchWorkflowTask } from './dispatch-workflow'
import { resolveTeamAssignmentForSingle } from './dispatch-team'

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

  // Team → agent resolution BEFORE the lock (review R3) — mirrors the
  // cycle's pre-pass; a slow router must not block other kicks or the
  // cycle. Transient failures join the failedDispatches ladder (review R2).
  if (!(await resolveTeamAssignmentForSingle(taskId, contentDir, source))) {
    log.debug('dispatchSingleTask: team resolution did not produce an agent', { taskId })
    return
  }

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

    // Resolution ran before the lock (resolveTeamAssignmentForSingle); a
    // task still unresolved here raced a concurrent un-assignment — skip.
    if (task.team && !task.agent) {
      log.debug('dispatchSingleTask: team task unresolved after pre-pass; skipping', { taskId })
      return
    }

    // Brand gate (#419): defer BEFORE the workflow branch so branded workflow
    // tasks whose brand is missing/draft stay in todo visibly (never move to
    // inProgress and throw). Same semantics as the cycle.
    const brandHoldEarly = await deferForMissingBrand(task, contentDir)
    if (brandHoldEarly) {
      log.debug('Single-task dispatch deferred by brand gate', { id: task.id, brandId: brandHoldEarly.brandId, source })
      return
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
          activityClass: 'user',
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
          activityClass: 'user',
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

    // Resolve routing BEFORE the budget gate (provider-scoped rules need the
    // turn's model); the fire reuses this exact resolution.
    const routing = await resolveDispatchRouting(task, source === 'recovery')

    // Spend ceiling — defer (leave in todo) when a budget cap is hit.
    if (await deferForBudget(targetAgent, contentDir, undefined, { model: routing.model })) {
      log.debug('Single-task dispatch deferred by budget gate', { id: task.id, agent: targetAgent, source })
      return
    }

    // Shared prepare: claim → build → move → audit (see prepareRegularDispatch).
    const dispatchStart = Date.now()
    const prepared = await prepareRegularDispatch({
      task,
      targetAgent,
      contentDir,
      port,
      mainAgentId,
      runtimeRoster,
      recovery: failure?.sessionDeath,
      continuation,
      logPrefix: 'Immediate dispatch failed',
      isRecovery: source === 'recovery',
      routing,
      path: 'single',
    })
    if (prepared.status === 'suppressed') return
    // A prep failure propagates out of dispatchSingleTask (its callers — kick,
    // continuation, ladder — handle/log it); the claim was already released.
    if (prepared.status === 'prep-failed') throw prepared.error

    const turn = prepared.turn
    try {
      // Single dispatch persists its dispatched marker per call (the cycle
      // batches one save for its whole collection). The claim + move are
      // already durable; this records the advisory bookkeeping.
      state.dispatched.push(task.id)
      trimDispatched(state, settings.dispatch.maxDispatched)
      saveDispatchState(contentDir, state)
    } catch (err) {
      // A claim whose turn will never fire must be released, or the task is
      // locked until the watchdog/boot sweep notices.
      try {
        loseRun(turn.threadId, 'dispatch-prep-failed')
      } catch (releaseErr) {
        log.error('Failed to release claim after state-save failure', releaseErr, { threadId: turn.threadId })
      }
      throw err
    }

    if (source !== 'continuation') {
      appendAudit(contentDir, 'task.kicked', source, { id: task.id, title: task.title })
    }
    log.info('Single-task dispatch', { id: task.id, title: task.title, agent: targetAgent, source, threadId: turn.threadId })
    fireDispatchTurn({
      ...turn,
      onSettled: (outcome, err) => {
        recordUsage({
          kind: 'agent',
          activityClass: 'user',
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
