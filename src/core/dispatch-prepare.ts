/**
 * The shared per-task fire preparation for REGULAR (non-workflow) dispatch:
 * the claim → lesson → assets → message → move → audit sequence that the
 * periodic cycle (`dispatchTasks`) and immediate single dispatch
 * (`dispatchSingleTask`) previously ran as two near-identical ~30-line copies.
 *
 * The ledger claim is the extraction boundary. Concurrency + budget gating
 * stays in the callers on purpose — their deferral semantics differ (the cycle
 * reserves slots for collected-but-unfired turns and defers silently; single
 * logs a recovery-deferral and reserves nothing). Everything from the claim
 * onward is identical and lives here.
 *
 * The result carries the `fireDispatchTurn` payload WITHOUT `onSettled`, so
 * each caller keeps its own fire shape:
 *   - the cycle COLLECTS the payload for its two-phase flow (one batched state
 *     save, then fire all) and records no per-turn `onSettled` usage;
 *   - single fires immediately and attaches the `onSettled` dispatch
 *     duration/status usage entry.
 * That usage-recording asymmetry is PRESERVED deliberately: `meterAgentTurn`
 * (inside `fireDispatchTurn`) already records the token/cost usage entry for
 * EVERY turn on BOTH paths, so the cost metering has no gap. The extra
 * `name:'dispatch'` duration entry is single-only telemetry, and unifying it
 * would change the live usage feed — a separate, feed-affecting decision that
 * does not belong in a behavior-neutral dedup.
 */
import { createLogger } from './logger'
import { appendAudit } from './audit'
import { loseRun } from './execution-ledger'
import { buildTaskLessonQuery } from './agent-packages/lesson-retrieval'
import type { DispatchTask, DispatchRosterAgent, DispatchContinuationContext, SessionDeathState } from './dispatch-types'
import { buildDispatchLessonBlock, buildDispatchAssetBlock } from './dispatch-context-blocks'
import { buildDispatchMessage, buildDecompositionMessage } from './dispatch-prompts'
import { moveTaskToInProgress } from './dispatch-board'
import { claimDispatchRun, auditDispatchSuppressed, fireDispatchTurn } from './dispatch-turns'
import type { ResolvedTurn } from './model-routing'

const log = createLogger('dispatch-prepare')

/** The fireDispatchTurn payload minus onSettled — the caller owns the fire. */
export type PreparedTurn = Omit<Parameters<typeof fireDispatchTurn>[0], 'onSettled'>

export type PrepareRegularDispatchResult =
  | { status: 'ready'; turn: PreparedTurn }
  | { status: 'suppressed' }
  | { status: 'prep-failed'; error: unknown }

/**
 * Claim a run, build the dispatch message, move the task to inProgress, and
 * audit `task.dispatched` — the shared regular-dispatch preparation. The
 * caller must have already cleared the concurrency + budget gates.
 *
 * Claim FIRST: the ledger run row is the lock; everything after it is a side
 * effect, so a duplicate (overlapping cycle, racing kick, second process)
 * fails at the claim before any build/move/send. On a suppressed claim this
 * audits `task.dispatch_suppressed` and returns `suppressed`. On a build/move
 * failure it releases the claim (`loseRun`) — so the caller never leaks a
 * claim that would lock the task until the watchdog/boot sweep — and returns
 * `prep-failed`. On success it returns the `fireDispatchTurn` payload for the
 * caller to collect (cycle) or fire (single).
 */
export async function prepareRegularDispatch(input: {
  task: DispatchTask
  targetAgent: string
  contentDir: string
  port: number
  mainAgentId: string
  runtimeRoster: DispatchRosterAgent[]
  /** The session-death record driving a recovery re-dispatch, if any. */
  recovery: SessionDeathState | undefined
  /** Dependency/subtask continuation context ({} for the periodic cycle). */
  continuation: DispatchContinuationContext
  /** Log label the fired turn uses on failure. */
  logPrefix: string
  /** Route the turn to the 'recovery' origin policy. */
  isRecovery: boolean
  /** Routing the caller already resolved for the budget gate — reused by the fire. */
  routing?: ResolvedTurn
  /** Which path is dispatching — used only for the suppressed-claim audit. */
  path: 'cycle' | 'single'
}): Promise<PrepareRegularDispatchResult> {
  const { task, targetAgent, contentDir, port, mainAgentId, runtimeRoster, recovery, continuation, logPrefix, isRecovery, routing, path } = input

  // Claim FIRST — the ledger row is the lock (see fn doc).
  const claim = claimDispatchRun(task.id, targetAgent)
  if (!claim.claimed) {
    auditDispatchSuppressed(contentDir, task, targetAgent, claim.liveRunId, path)
    return { status: 'suppressed' }
  }

  try {
    const lessonBlock = await buildDispatchLessonBlock({
      contentDir,
      taskId: task.id,
      title: task.title,
      agentId: targetAgent,
      query: buildTaskLessonQuery(task),
    })
    const assetsBlock = await buildDispatchAssetBlock(task.id)
    const message = recovery?.stage === 'decomposition'
      ? buildDecompositionMessage(task, targetAgent, recovery)
      : buildDispatchMessage(task, targetAgent, contentDir, mainAgentId, lessonBlock, continuation, recovery, runtimeRoster, assetsBlock)
    const initialLogCount = task.log?.length ?? 0

    // Move to inProgress BEFORE the turn fires to eliminate the race where a
    // fast agent completes before dispatch moves the task.
    await moveTaskToInProgress(task.id, targetAgent)

    const threadId = claim.runId
    // The internal todo→inProgress move is folded into task.dispatched — one
    // audit row per dispatch, carrying the transition.
    appendAudit(contentDir, 'task.dispatched', targetAgent, { id: task.id, title: task.title, threadId, from: 'todo', to: 'inProgress' })
    log.info('Task dispatched', { id: task.id, title: task.title, agent: targetAgent, threadId, path })

    return {
      status: 'ready',
      turn: {
        marker: task.id,
        task,
        targetAgent,
        threadId,
        message,
        contentDir,
        port,
        initialLogCount,
        logPrefix,
        dispatchKind: 'regular',
        isRecovery,
        ...(routing ? { routing } : {}),
      },
    }
  } catch (error) {
    // A claim whose turn will never fire must be released, or the task is
    // locked until the watchdog/boot sweep notices it.
    try {
      loseRun(claim.runId, 'dispatch-prep-failed')
    } catch (releaseErr) {
      log.error('Failed to release claim after prep failure', releaseErr, { threadId: claim.runId })
    }
    return { status: 'prep-failed', error }
  }
}
