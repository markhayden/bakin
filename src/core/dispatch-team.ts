/**
 * Team-assignment resolution for dispatch (#189).
 *
 * When a task carries `team` but no `agent`, dispatch resolves it to a
 * concrete member BEFORE the concurrency gate and ledger claim by invoking
 * the team plugin's `team.resolveAssignment` hook (HookRegistry RPC — core
 * never imports plugin code). The resolved agent is persisted immediately
 * (recordTeamResolution retains `team` for audit), so retries and later
 * cycles see a plain agent task and the routing LLM is billed at most once
 * per task lifetime.
 *
 * Failure policy (spec: honest-state, no silent picks):
 *   - transient (provider hiccup, out-of-pool pick) → skip this cycle,
 *     retried next tick; reason logged once (no per-cycle log spam)
 *   - structural (no key, unknown team, empty pool, hook missing) → task
 *     BLOCKED with a clear reason — never silently routed to an arbitrary
 *     member or the main agent.
 * Outcomes are classified by the typed `kind` field, never message text.
 */
import { createLogger } from './logger'
import { appendAudit } from './audit'
import { getSettings } from './settings'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { addTaskLog, blockTask, getTask, recordTeamResolution } from './task-store'
import { readDispatchColumns } from './dispatch-board'
import {
  withStateLock,
  loadDispatchState,
  saveDispatchState,
  getFailureRecord,
  cooldownForFailure,
} from './dispatch-state'
import type { DispatchState, DispatchTask } from './dispatch-types'

const log = createLogger('dispatch-team')

export const TEAM_RESOLVE_HOOK = 'team.resolveAssignment'

/** Structural mirror of the team plugin's ResolveAssignmentResult — typed at
 * the call site per the HookRegistry contract (core must not import plugin
 * modules). */
type ResolveAssignmentResult =
  | { ok: true; agentId: string; reason: string; model: string }
  | { ok: false; kind: 'transient' | 'structural'; message: string }

export type TeamResolutionOutcome =
  | { status: 'resolved'; agentId: string }
  | { status: 'skipped' }
  | { status: 'blocked' }
  /** The task changed while the router was thinking (re-assigned, resolved
   * elsewhere, deleted) — result discarded, nothing recorded (round-3). */
  | { status: 'stale' }

/** Append a task log line unless the identical line is already the most
 * recent entry — a transient failure retried every cycle logs once. */
async function addTaskLogOnce(task: DispatchTask, message: string): Promise<void> {
  const last = task.log?.[task.log.length - 1]?.message
  if (last === message) return
  await addTaskLog(task.id, 'system', message)
}

export async function resolveTeamAssignmentForDispatch(
  task: DispatchTask,
  contentDir: string,
): Promise<TeamResolutionOutcome> {
  const team = task.team!
  const registry = getHookRegistry()

  const blockWith = async (message: string): Promise<TeamResolutionOutcome> => {
    log.warn('Team resolution blocked task', { id: task.id, team, message })
    appendAudit(contentDir, 'task.team_resolution_failed', 'system', {
      id: task.id, title: task.title, team, kind: 'structural', message,
    })
    await blockTask(task.id, `Team routing failed: ${message}`)
    return { status: 'blocked' }
  }

  try {
    if (!registry.has(TEAM_RESOLVE_HOOK)) {
      return await blockWith(`${TEAM_RESOLVE_HOOK} hook is not registered (team plugin unavailable)`)
    }

    const result = await registry.invoke<ResolveAssignmentResult>(TEAM_RESOLVE_HOOK, {
      teamId: team,
      task: { id: task.id, title: task.title, description: task.description, tags: task.tags },
    })
    if (!result) {
      return await blockWith(`${TEAM_RESOLVE_HOOK} returned no result`)
    }

    if (result.ok) {
      // Stale-write guard (round-3 finding): the routing call is slow and
      // unlocked — if the task was meanwhile resolved elsewhere, re-assigned,
      // or deleted, discard this result instead of overwriting a possibly
      // already-dispatched task's agent.
      const current = getTask(task.id)
      if (!current || current.agent || current.team !== team) {
        log.warn('Team resolution result discarded — task changed while routing', {
          id: task.id, team, pick: result.agentId,
        })
        return { status: 'stale' }
      }
      await recordTeamResolution(task.id, result.agentId)
      task.agent = result.agentId
      await addTaskLog(task.id, 'system', `Routed to ${result.agentId} (team ${team}): ${result.reason}`)
      appendAudit(contentDir, 'task.team_resolved', 'system', {
        id: task.id, title: task.title, team, agent: result.agentId, reason: result.reason, model: result.model,
      })
      log.info('Team task resolved', { id: task.id, team, agent: result.agentId })
      return { status: 'resolved', agentId: result.agentId }
    }

    if (result.kind === 'structural') {
      return await blockWith(result.message)
    }

    // Transient — leave the task in todo; the next cycle retries.
    log.debug('Team resolution transient failure; will retry next cycle', { id: task.id, team, message: result.message })
    appendAudit(contentDir, 'task.team_resolution_failed', 'system', {
      id: task.id, title: task.title, team, kind: 'transient', message: result.message,
    })
    await addTaskLogOnce(task, `Team routing deferred (will retry): ${result.message}`)
    return { status: 'skipped' }
  } catch (err) {
    // A throwing hook is treated as transient — the resolver itself returns
    // typed failures; an exception here is infrastructure, not policy. It
    // still gets the SAME board-visible signal as a typed transient failure
    // (review R8): a task-log line + audit, never just a server-log entry.
    const message = err instanceof Error ? err.message : String(err)
    log.error('Team resolution hook threw; skipping this cycle', err, { id: task.id, team })
    appendAudit(contentDir, 'task.team_resolution_failed', 'system', {
      id: task.id, title: task.title, team, kind: 'transient', message,
    })
    await addTaskLogOnce(task, `Team routing deferred (will retry): ${message}`).catch(() => {})
    return { status: 'skipped' }
  }
}

/** Record a transient team-resolution failure in the SAME failedDispatches
 * ladder every other dispatch failure uses (review R2): the cooldown gate
 * spaces retries and the exhausted gate escalates to blocked, so a
 * persistently confused router cannot bill LLM calls every cycle forever.
 * Any prior sessionDeath context is DROPPED deliberately (round-3 finding):
 * it described a previous agent-run of this task; once the task is an
 * unresolved team task the recovery ladder no longer owns it, and keeping
 * the marker exempted the record from every pacing gate. */
export function recordTeamResolutionFailure(state: DispatchState, taskId: string): void {
  const prev = state.failedDispatches[taskId]
  state.failedDispatches[taskId] = {
    count: (prev?.count ?? 0) + 1,
    lastAttempt: Date.now(),
    kind: 'transient',
  }
}

type LadderGate = 'cooldown' | 'exhausted' | null

/** Pacing gate shared by both resolution paths. sessionDeath records are
 * NOT exempt here (round-3 finding): that exemption exists for the recovery
 * ladder's re-dispatches of an AGENT task — an unresolved team task cannot
 * be ladder-managed, and exempting it meant unbounded routing retries. */
function ladderGate(
  state: DispatchState,
  taskId: string,
  settings: ReturnType<typeof getSettings>,
): LadderGate {
  const failure = getFailureRecord(state.failedDispatches?.[taskId])
  if (!failure) return null
  if (failure.count >= settings.dispatch.maxRetries) return 'exhausted'
  return Date.now() - failure.lastAttempt < cooldownForFailure(failure, settings) ? 'cooldown' : null
}

/** Escalate an exhausted team task to blocked — the pre-pass owns this for
 * team tasks (the cycle loop's generic escalation never sees a task the
 * pre-pass already blocked, and its sessionDeath exemption would strand
 * re-assigned tasks forever). */
async function escalateExhaustedResolution(task: DispatchTask, contentDir: string, count: number): Promise<void> {
  try {
    appendAudit(contentDir, 'task.team_resolution_failed', 'system', {
      id: task.id, title: task.title, team: task.team, kind: 'structural',
      message: `exhausted after ${count} transient routing failures`,
    })
    await blockTask(task.id, `Team routing failed ${count} times — check the routing provider/key (Team settings), then re-assign or unblock to retry`)
    log.warn('Team task blocked after exhausting routing retries', { id: task.id, team: task.team, count })
  } catch (err) {
    log.error('Failed to block routing-exhausted task', err, { id: task.id })
  }
}

/** Task ids with a routing call in flight RIGHT NOW. A kick racing the
 * cycle — or a force-released dispatch mutex starting an overlapping
 * cycle — must never double-bill the router or double-write the pick
 * (round-3 finding). Single-process module state is sufficient: dispatch
 * runs in one server process behind the singleton lock. */
const resolvingTaskIds = new Set<string>()
let prePassRunning = false

/** Resolution-time eligibility (round-3 finding): a task that cannot
 * dispatch yet (future availableAt, unmet dependency) must not bill the
 * router — the pick could go stale long before the task fires. Mirrors the
 * relevant gates of isTaskDispatchEligible without needing the roster. */
function isResolutionEligible(task: DispatchTask, completedTaskIds: Set<string>, nowMs: number): boolean {
  if (task.availableAt) {
    const availableMs = Date.parse(task.availableAt)
    if (!Number.isNaN(availableMs) && availableMs > nowMs) return false
  }
  if (task.dependsOn && !completedTaskIds.has(task.dependsOn)) return false
  return true
}

/**
 * Resolve every unresolved team task BEFORE the dispatch state lock is
 * taken (review R3): a routing call can take up to a minute, and holding the
 * cycle lock through it would stall ALL dispatch — including kicks. The
 * resolver writes only task-store state; the ladder bookkeeping for skipped
 * tasks takes the state lock briefly at the end.
 *
 * Concurrency shape (round-3 findings): re-entrant calls return immediately
 * (a force-released dispatch mutex can start an overlapping cycle), tasks
 * resolve CONCURRENTLY so N slow routing calls cost one timeout rather than
 * N, and the in-flight set keeps kicks and cycles off each other's tasks.
 */
export async function resolveTeamAssignmentsPrePass(contentDir: string): Promise<void> {
  if (prePassRunning) {
    log.debug('Team resolution pre-pass already running; skipping re-entrant call')
    return
  }
  prePassRunning = true
  try {
    const columns = await readDispatchColumns()
    const nowMs = Date.now()
    const completedTaskIds = new Set([...columns.done, ...columns.archived].map((t) => t.id))
    const candidates = columns.todo.filter((t) =>
      t.team && !t.agent && !resolvingTaskIds.has(t.id) && isResolutionEligible(t, completedTaskIds, nowMs))
    if (candidates.length === 0) return

    const settings = getSettings()
    // Lock-free advisory read — gating only; mutations happen under the lock.
    const state = loadDispatchState(contentDir)
    const toResolve: DispatchTask[] = []
    for (const task of candidates) {
      const gate = ladderGate(state, task.id, settings)
      if (gate === 'exhausted') {
        await escalateExhaustedResolution(task, contentDir, getFailureRecord(state.failedDispatches?.[task.id])?.count ?? settings.dispatch.maxRetries)
        continue
      }
      if (gate === 'cooldown') continue
      toResolve.push(task)
    }
    if (toResolve.length === 0) return

    const skippedIds: string[] = []
    await Promise.all(toResolve.map(async (task) => {
      if (resolvingTaskIds.has(task.id)) return
      resolvingTaskIds.add(task.id)
      try {
        const outcome = await resolveTeamAssignmentForDispatch(task, contentDir)
        if (outcome.status === 'skipped') skippedIds.push(task.id)
      } finally {
        resolvingTaskIds.delete(task.id)
      }
    }))

    if (skippedIds.length > 0) {
      await withStateLock(async () => {
        const fresh = loadDispatchState(contentDir)
        for (const id of skippedIds) recordTeamResolutionFailure(fresh, id)
        saveDispatchState(contentDir, fresh)
      })
    }
  } finally {
    prePassRunning = false
  }
}

/** dispatchSingleTask's pre-lock counterpart of the cycle pre-pass.
 * Returns true when the caller may proceed into its locked section. */
export async function resolveTeamAssignmentForSingle(
  taskId: string,
  contentDir: string,
): Promise<boolean> {
  const columns = await readDispatchColumns()
  const task = columns.todo.find((t) => t.id === taskId)
  if (!task || !task.team || task.agent) return true

  if (resolvingTaskIds.has(taskId)) {
    log.debug('Single-task team resolution already in flight elsewhere; skipping', { taskId })
    return false
  }

  const settings = getSettings()
  const gate = ladderGate(loadDispatchState(contentDir), taskId, settings)
  if (gate === 'exhausted') {
    await escalateExhaustedResolution(task, contentDir, settings.dispatch.maxRetries)
    return false
  }
  if (gate === 'cooldown') {
    log.debug('Single-task team resolution gated by failure ladder cooldown', { taskId })
    return false
  }

  resolvingTaskIds.add(taskId)
  try {
    const outcome = await resolveTeamAssignmentForDispatch(task, contentDir)
    if (outcome.status === 'skipped') {
      await withStateLock(async () => {
        const fresh = loadDispatchState(contentDir)
        recordTeamResolutionFailure(fresh, taskId)
        saveDispatchState(contentDir, fresh)
      })
      return false
    }
    return outcome.status === 'resolved'
  } finally {
    resolvingTaskIds.delete(taskId)
  }
}
