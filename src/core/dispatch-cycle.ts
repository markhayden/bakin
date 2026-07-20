/**
 * The periodic dispatch cycle: the two-phase collect-then-fire scan over the
 * taskboard, the cycle mutex/timer singletons, start/stop, and getDispatchInfo.
 * Extracted from dispatch.ts. Owns the `dispatching`/`dispatchStartedAt`/
 * `dispatchTimer` cycle singletons.
 */
import { createLogger } from './logger'
import { appendAudit } from './audit'
import { getSettings } from './settings'
import { getAppServices } from './app-services-store'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import { loseRun } from './execution-ledger'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { blockTask as blockStoredTask } from './task-store'
import type { DispatchRosterAgent } from './dispatch-types'
import {
  withStateLock,
  loadDispatchState,
  saveDispatchState,
  getFailureRecord,
  cooldownForFailure,
  getDispatchMarkerTaskId,
  trimDispatched,
} from './dispatch-state'
import { readDispatchColumns, isTaskDispatchEligible, addTaskLog, moveTaskToInProgress, tryAddTaskLog } from './dispatch-board'
import { concurrencyGate, deferForBudget, fireDispatchTurn, resolveDispatchRouting, type BudgetSpendMemo } from './dispatch-turns'
import { prepareRegularDispatch } from './dispatch-prepare'
import { deferForMissingBrand } from './dispatch-context-blocks'
import { dispatchWorkflowTask } from './dispatch-workflow'
import { resolveTeamAssignmentsPrePass } from './dispatch-team'

const log = createLogger('dispatch-cycle')
const hooks = () => getHookRegistry()

let dispatching = false
let dispatchStartedAt = 0
let dispatchTimer: NodeJS.Timeout | null = null
const DISPATCH_TIMEOUT_MS = 3 * 60 * 1000 // 3 minutes max per dispatch cycle

/** Shared dispatched[] cap — both dispatch paths must honor the setting. */
export async function dispatchTasks(contentDir: string, port: number): Promise<void> {
  // If a previous dispatch is stuck (>3min), force-release the mutex
  if (dispatching && dispatchStartedAt > 0 && (Date.now() - dispatchStartedAt) > DISPATCH_TIMEOUT_MS) {
    log.warn('Dispatch mutex stuck — force-releasing after timeout', { stuckSinceMs: Date.now() - dispatchStartedAt })
    dispatching = false
  }
  if (dispatching) return
  dispatching = true
  dispatchStartedAt = Date.now()

  const settings = getSettings()

  try {
    // Team → agent resolution runs BEFORE the state lock (review R3): a
    // routing LLM call can take up to a minute, and holding the cycle lock
    // through it would stall all dispatch, kicks included. Failures land in
    // the failedDispatches ladder (review R2) read by the loop below.
    await resolveTeamAssignmentsPrePass(contentDir)

    // Acquire state lock for the entire cycle to prevent races with dispatchSingleTask
    await withStateLock(async () => {
    const state = loadDispatchState(contentDir)
    const runtime = getAppServices().runtime
    const runtimeAgents = await runtime.agents.list()
    const runtimeAgentIds = new Set(runtimeAgents.map((agent) => agent.id))
    const runtimeRoster: DispatchRosterAgent[] = runtimeAgents.map((agent) => ({
      id: agent.id,
      ...(agent.role ? { role: agent.role } : {}),
    }))
    const mainAgentId = await getRuntimeMainAgentId(runtime)
    // Reconcile dispatch state with taskboard reality
    const columns = await readDispatchColumns()
    const todoTasks = columns.todo
    const activeIds = new Set(columns.inProgress.map(t => t.id))
    const completedTaskIds = new Set([
      ...columns.done.map(t => t.id),
      ...columns.archived.map(t => t.id),
    ])
    const knownTaskIds = new Set(
      Object.values(columns).flatMap((column) => column.map((t) => t.id)),
    )
    for (const task of [
      ...columns.done,
      ...columns.archived,
      ...columns.blocked,
      ...columns.review,
    ]) {
      delete state.failedDispatches?.[task.id]
    }
    state.dispatched = state.dispatched.filter(id => activeIds.has(getDispatchMarkerTaskId(id)))
    // Rebuild dispatchedSet AFTER reconciliation so tasks moved back to todo are eligible
    const dispatchedSet = new Set(state.dispatched)
    for (const task of columns.inProgress) {
      if (!dispatchedSet.has(task.id)) {
        dispatchedSet.add(task.id)
        state.dispatched.push(task.id)
      }
    }

    // ─── Dispatch in-progress workflow tasks that changed step agents ──
    // After gate approval, the workflow advances to a new agent's step but
    // the task stays in inProgress. We need to dispatch the new agent.
    for (const task of columns.inProgress) {
      const wfTask = task as typeof task & { workflowId?: string }
      if (!wfTask.workflowId) continue

      // Check if the current workflow step agent has been dispatched
      const activeAgents = await hooks().invoke<Array<{ agent: string; stepId: string; effectiveTaskId?: string }>>('workflows.getActiveAgents', { taskId: task.id }) ?? []
      const needsDispatch = activeAgents.some(({ stepId, effectiveTaskId }) => !dispatchedSet.has(`${effectiveTaskId || task.id}:${stepId}`))
      if (!needsDispatch) continue

      try {
        await dispatchWorkflowTask(
          { ...wfTask, workflowId: wfTask.workflowId },
          contentDir, port, dispatchedSet, state,
          async () => {}, // already in progress, no column move needed
          addTaskLog,
          mainAgentId,
        )
      } catch (err) {
        log.error(`Failed to re-dispatch workflow task "${task.title}"`, err)
      }
    }

    if (todoTasks.length === 0) {
      saveDispatchState(contentDir, state)
      return
    }

    // Two-phase dispatch: phase 1 collects intents (move + mint + message
    // build, seqs minted in-memory via deferSave), then ONE state save
    // persists every minted seq, then phase 2 fires the turns. This keeps
    // persist-before-send (a seq is always durable before its turn is sent)
    // while collapsing the old N+1 full-file state writes per cycle to 1.
    // A mid-loop failure loses only unminted work: collected intents have
    // not fired yet, and unfired seqs re-mint identically next cycle.
    const pendingTurns: Array<Parameters<typeof fireDispatchTurn>[0]> = []
    const pendingByAgent = new Map<string, number>()
    // Per-cycle memo for the spend engine (facets are identical for every
    // task in this cycle; costs only land on settle, after the loop).
    const budgetSpendCache: BudgetSpendMemo = {}

    for (const task of todoTasks) {
      if (dispatchedSet.has(task.id)) continue

      const eligibility = isTaskDispatchEligible(task, {
        nowMs: Date.now(),
        runtimeAgentIds,
        completedTaskIds,
        knownTaskIds,
      })
      if (!eligibility.eligible) continue
      if (eligibility.danglingDependency) {
        log.warn('Task dependency target no longer exists; treating as satisfied', { id: task.id, dependsOn: eligibility.danglingDependency })
        await tryAddTaskLog(task.id, 'system', `Dependency task ${eligibility.danglingDependency} no longer exists (likely archived/removed). Treating the dependency as satisfied and dispatching.`)
      }

      // Check failure history with max retries. Session-death records are
      // ladder-managed (corrective/decomposition with their own caps) and
      // bypass the generic cooldown — waiting doesn't fix a deterministic
      // failure; the changed approach does.
      const failure = getFailureRecord(state.failedDispatches?.[task.id])
      if (failure && !failure.sessionDeath) {
        if (failure.count >= settings.dispatch.maxRetries) {
          // Escalate to blocked
          try {
            await blockStoredTask(task.id, `Dispatch failed ${failure.count} times - agent may be unavailable`)
            await addTaskLog(task.id, 'system', `Dispatch exhausted: ${failure.count} failed attempts. Task moved to blocked.`)
            appendAudit(contentDir, 'task.dispatch_exhausted', 'system', { id: task.id, title: task.title, count: failure.count })
            log.warn('Task blocked after max dispatch retries', { id: task.id, count: failure.count })
          } catch (err) {
            log.error('Failed to block exhausted task', err)
          }
          continue
        }
        if (Date.now() - failure.lastAttempt < cooldownForFailure(failure, settings)) continue
      }

      // Team tasks the pre-lock pass could not resolve this round sit out
      // the cycle; the ladder check above escalates to blocked at
      // maxRetries and paces retries via the transient cooldown (#189).
      if (task.team && !task.agent) continue

      // Brand gate (#419): a task linked to a missing/draft brand stays in
      // todo (no claim, no inProgress move) and resumes the cycle the brand
      // exists — never dispatched brandless, never silently. Placed BEFORE the
      // workflow branch so workflow tasks defer visibly too (the workflow path
      // would otherwise move to inProgress and throw, sitting silently stuck).
      const brandHoldEarly = await deferForMissingBrand(task, contentDir)
      if (brandHoldEarly) {
        log.debug('Dispatch deferred by brand gate', { id: task.id, brandId: brandHoldEarly.brandId })
        continue
      }

      // Workflow-aware dispatch path
      const taskWithWorkflow = task as typeof task & { workflowId?: string }
      if (taskWithWorkflow.workflowId) {
        try {
          // Workflow steps fire immediately — their gate must see the slots
          // this cycle's collected-but-unfired regular turns already hold.
          await dispatchWorkflowTask(
            { ...taskWithWorkflow, workflowId: taskWithWorkflow.workflowId },
            contentDir, port, dispatchedSet, state, moveTaskToInProgress, addTaskLog, mainAgentId,
            { total: pendingTurns.length, forAgent: pendingByAgent },
          )
        } catch (err) {
          log.error(`Failed to dispatch workflow task "${task.title}"`, err)
        }
        continue
      }

      const targetAgent = task.agent ?? mainAgentId

      // Bounded concurrency: a capped task is simply ineligible this cycle
      // (no failure recorded) — a later cycle picks it up when a slot frees.
      // Collected-but-unfired turns reserve their slots via pendingByAgent.
      const gate = concurrencyGate(targetAgent, settings, {
        total: pendingTurns.length,
        forAgent: pendingByAgent.get(targetAgent) ?? 0,
      })
      if (gate) {
        log.debug('Dispatch deferred by concurrency gate', { id: task.id, agent: targetAgent, gate })
        continue
      }

      // Resolve routing BEFORE the budget gate: provider-scoped rules need
      // to know which model/provider the turn would spend on, and the fire
      // reuses this exact resolution (one resolve per dispatch).
      const routing = await resolveDispatchRouting(task, !!failure?.sessionDeath)

      // Spend ceiling: defer (leave in todo) when a budget cap is hit. Runs
      // before the claim so we don't reserve a run we won't fire. The
      // per-cycle cache collapses the redundant global spend reads.
      if (await deferForBudget(targetAgent, contentDir, budgetSpendCache, { model: routing.model })) {
        log.debug('Dispatch deferred by budget gate', { id: task.id, agent: targetAgent })
        continue
      }

      // Shared prepare: claim → build → move → audit (see prepareRegularDispatch).
      // A prep failure here must not abort the cycle — collected intents and
      // other tasks still dispatch. The two-phase fire (collect now, save
      // once, fire all) is the cycle's own concern, so we COLLECT the returned
      // turn rather than firing it — and record no per-turn onSettled usage
      // (deliberate; see dispatch-prepare's header).
      const prepared = await prepareRegularDispatch({
        task,
        targetAgent,
        contentDir,
        port,
        mainAgentId,
        runtimeRoster,
        recovery: failure?.sessionDeath,
        continuation: {},
        logPrefix: 'Dispatch failed',
        // A task carrying a sessionDeath record is a recovery re-dispatch even
        // on the main cycle (e.g. the ladder's immediate re-dispatch was lost
        // to a restart or budget-deferred). Route it to the 'recovery' origin
        // just like dispatchSingleTask(...,'recovery').
        isRecovery: !!failure?.sessionDeath,
        routing,
        path: 'cycle',
      })
      if (prepared.status === 'suppressed') continue
      if (prepared.status === 'prep-failed') {
        log.error(`Failed to prepare dispatch for task "${task.title}"`, prepared.error, { id: task.id })
        continue
      }
      dispatchedSet.add(task.id)
      pendingTurns.push(prepared.turn)
      pendingByAgent.set(targetAgent, (pendingByAgent.get(targetAgent) ?? 0) + 1)
    }

    state.lastRun = Date.now()
    state.dispatched = [...dispatchedSet]
    trimDispatched(state, settings.dispatch.maxDispatched)
    // Persist-before-send: every claimed run above is already durable in the
    // ledger; this write persists the advisory dispatch bookkeeping. If it
    // throws, the collected turns will never fire — release their claims or
    // the tasks stay locked until the watchdog/boot sweep notices.
    try {
      saveDispatchState(contentDir, state)
    } catch (err) {
      log.error('Dispatch state save failed — releasing collected run claims', err)
      for (const turn of pendingTurns) {
        try {
          loseRun(turn.threadId, 'dispatch-save-failed')
        } catch (releaseErr) {
          log.error('Failed to release collected claim', releaseErr, { threadId: turn.threadId })
        }
      }
      return
    }

    for (const turn of pendingTurns) fireDispatchTurn(turn)
    }) // end withStateLock
  } finally {
    dispatching = false
  }
}

export function start(contentDir: string, port: number): void {
  const settings = getSettings()
  startedWith = { contentDir, port }
  dispatchTimer = setInterval(() => {
    dispatchTasks(contentDir, port).catch(err => {
      log.error('Dispatch cycle failed', err)
      appendAudit(contentDir, 'system.dispatch_error', 'system', { error: err instanceof Error ? err.message : String(err) })
    })
  }, settings.dispatch.intervalMs)
  log.info('Dispatch started', { intervalMs: settings.dispatch.intervalMs })
}

let startedWith: { contentDir: string; port: number } | null = null

/**
 * Run a dispatch cycle NOW (cost-control v2): raising a cap / resuming a
 * pause incident must visibly unstick deferred tasks instead of leaving the
 * operator staring at a board that "did nothing" until the next interval.
 * No-op before start(); the cycle mutex dedupes an overlap with the timer.
 */
export function requestImmediateDispatch(reason: string): void {
  if (!startedWith) return
  const { contentDir, port } = startedWith
  log.info('Immediate dispatch requested', { reason })
  dispatchTasks(contentDir, port).catch(err => {
    log.error('Immediate dispatch failed', err, { reason })
  })
}

export function stop(): void {
  if (dispatchTimer) {
    clearInterval(dispatchTimer)
    dispatchTimer = null
    log.info('Dispatch stopped')
  }
}

export function getDispatchInfo(contentDir: string): Record<string, unknown> {
  const settings = getSettings()
  const state = loadDispatchState(contentDir)
  const now = Date.now()
  const interval = settings.dispatch.intervalMs
  const baseline = state.lastRun || state.serverStart || now

  // Calculate the next run time that's actually in the future.
  // If we've missed one or more intervals (e.g. dispatch was stuck),
  // advance to the next upcoming tick rather than showing 0:00.
  let nextRun = baseline + interval
  if (nextRun <= now) {
    const elapsed = now - baseline
    const missedIntervals = Math.floor(elapsed / interval)
    nextRun = baseline + (missedIntervals + 1) * interval
  }
  const secondsUntilNext = Math.max(0, Math.round((nextRun - now) / 1000))

  return {
    intervalMs: interval,
    intervalMin: interval / 60000,
    lastRun: state.lastRun ? new Date(state.lastRun).toISOString() : null,
    nextRun: new Date(nextRun).toISOString(),
    secondsUntilNext,
    dispatching,
    dispatchedCount: state.dispatched.length,
  }
}
