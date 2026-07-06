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
import { addTaskLog, blockTask, recordTeamResolution } from './task-store'
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
 * ladder every other dispatch failure uses (review R2): the cycle's cooldown
 * gate spaces retries and its maxRetries gate escalates to blocked, so a
 * persistently confused router cannot bill LLM calls every cycle forever. */
export function recordTeamResolutionFailure(state: DispatchState, taskId: string): void {
  const prev = state.failedDispatches[taskId]
  state.failedDispatches[taskId] = {
    ...(prev ?? {}),
    count: (prev?.count ?? 0) + 1,
    lastAttempt: Date.now(),
    kind: 'transient',
  }
}

/** Gate shared by both dispatch paths: skip resolution while the ladder is
 * cooling down or exhausted (the cycle loop owns the escalate-to-blocked). */
function ladderBlocksResolution(
  state: DispatchState,
  taskId: string,
  settings: ReturnType<typeof getSettings>,
): boolean {
  const failure = getFailureRecord(state.failedDispatches?.[taskId])
  if (!failure || failure.sessionDeath) return false
  if (failure.count >= settings.dispatch.maxRetries) return true
  return Date.now() - failure.lastAttempt < cooldownForFailure(failure, settings)
}

/**
 * Resolve every unresolved team task BEFORE the dispatch state lock is
 * taken (review R3): a routing call can take up to a minute, and holding the
 * cycle lock through it would stall ALL dispatch — including kicks. The
 * resolver writes only task-store state; the ladder bookkeeping for skipped
 * tasks takes the state lock briefly at the end.
 */
export async function resolveTeamAssignmentsPrePass(contentDir: string): Promise<void> {
  const columns = await readDispatchColumns()
  const unresolved = columns.todo.filter((t) => t.team && !t.agent)
  if (unresolved.length === 0) return

  const settings = getSettings()
  // Lock-free advisory read — gating only; mutations happen under the lock.
  const state = loadDispatchState(contentDir)
  const skippedIds: string[] = []

  for (const task of unresolved) {
    if (ladderBlocksResolution(state, task.id, settings)) continue
    const outcome = await resolveTeamAssignmentForDispatch(task, contentDir)
    if (outcome.status === 'skipped') skippedIds.push(task.id)
  }

  if (skippedIds.length > 0) {
    await withStateLock(async () => {
      const fresh = loadDispatchState(contentDir)
      for (const id of skippedIds) recordTeamResolutionFailure(fresh, id)
      saveDispatchState(contentDir, fresh)
    })
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

  const settings = getSettings()
  if (ladderBlocksResolution(loadDispatchState(contentDir), taskId, settings)) {
    log.debug('Single-task team resolution gated by failure ladder', { taskId })
    return false
  }

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
}
