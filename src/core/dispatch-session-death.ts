/**
 * The session-death recovery ladder + dispatch-rejection reconciliation,
 * extracted from dispatch.ts.
 *
 * Cycle break: handleSessionDeath's immediate ladder re-dispatch calls
 * dispatchSingleTask, which would form an import cycle (single → turns →
 * session-death → single). It's resolved with a LAZY dynamic import at
 * re-dispatch time (inside the delayed callback) — no static cycle, and no
 * dependency on any barrel-load wiring. turns ↔ session-death is an intentional
 * runtime-only cycle (fireDispatchTurn calls reconcileRejectedDispatch here;
 * handleSessionDeath calls turns' scheduleLadderRedispatch).
 */
import { join } from 'path'
import { writeFileSync } from 'fs'
import { createLogger } from './logger'
import { appendAudit } from './audit'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { currentSeq } from './execution-ledger'
import { RuntimeTurnError } from '@bakin/core/adapters/runtime'
import { blockTask as blockStoredTask, moveTask as moveStoredTask } from './task-store'
import { formatSanitizedRuntimeFailure, classifyDispatchError, classifyDispatchFailureDetail } from './dispatch-failures'
import type { DispatchState, DispatchTask, DispatchColumns, SessionDeathState, SessionDeathDiagnosisLite } from './dispatch-types'
import { getFailureRecord, removeDispatchMarkersForTask } from './dispatch-state'
import { findDispatchTaskSnapshot, taskAlreadyLeftActiveWork, shouldBlockAfterDispatchFailure, tryAddTaskLog } from './dispatch-board'
import { scheduleLadderRedispatch } from './dispatch-turns'

const log = createLogger('dispatch-session-death')
const hooks = () => getHookRegistry()

// How long after a session death before the automatic ladder re-dispatch
// fires. Just enough to let the state lock release; deliberately NOT a
// cooldown — retrying a deterministic failure later doesn't make it pass,
// changing the approach (corrective prompt / decomposition) does.
const SESSION_DEATH_REDISPATCH_DELAY_MS = 50

// Ladder caps: regular tasks get corrective → decomposition → block;
// workflow steps get corrective → block (step structure is owned by the
// workflow engine — an agent must not decompose someone else's workflow).
const MAX_SESSION_DEATHS_REGULAR = 3
const MAX_SESSION_DEATHS_WORKFLOW = 2

function stripSalvage(diagnosis: RuntimeTurnError['diagnosis']): SessionDeathDiagnosisLite {
  return {
    reason: diagnosis.reason,
    ...(diagnosis.sessionId ? { sessionId: diagnosis.sessionId } : {}),
    ...(diagnosis.sessionStatus ? { sessionStatus: diagnosis.sessionStatus } : {}),
    ...(diagnosis.completionBytes !== undefined ? { completionBytes: diagnosis.completionBytes } : {}),
    ...(diagnosis.outputTruncated !== undefined ? { outputTruncated: diagnosis.outputTruncated } : {}),
    ...(diagnosis.oversizedOutput !== undefined ? { oversizedOutput: diagnosis.oversizedOutput } : {}),
    ...(diagnosis.lastToolCall ? { lastToolCall: diagnosis.lastToolCall } : {}),
    ...(diagnosis.detail ? { detail: diagnosis.detail } : {}),
  }
}

/**
 * Persist the truncated completion text the adapter salvaged from the dead
 * session as a task-linked asset. The blocked/retried task then carries the
 * partial deliverable instead of losing it — and the corrective prompt can
 * point the agent at it so work isn't regenerated from scratch.
 */
async function salvageSessionDeathOutput(input: {
  contentDir: string
  taskId: string
  agent: string
  seq: number
  salvagedText: string
}): Promise<string | undefined> {
  try {
    const dir = join(input.contentDir, 'tasks', 'salvage')
    const { mkdirSync } = await import('fs')
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, `${input.taskId}-d${input.seq}.md`)
    writeFileSync(filePath, input.salvagedText, 'utf-8')
    const result = await hooks().invoke<{ assetId: string; version: number; changed: boolean }>('assets.saveFromSource', {
      filePath,
      taskId: input.taskId,
      agent: input.agent,
      type: 'text',
      description: 'Partial output salvaged from a dead runtime session (truncated by the provider)',
      tags: ['salvaged-output'],
      tool: 'session-forensics',
    })
    return result?.assetId
  } catch (err) {
    log.warn('Failed to salvage session-death output as asset', err, { taskId: input.taskId })
    return undefined
  }
}

/**
 * The session-death recovery ladder. Diagnosed deaths are deterministic —
 * blind retries reproduce them (the originating incident proved it twice) —
 * so each rung changes the approach instead of waiting out a cooldown:
 *
 *   death 1 → salvage partial output → IMMEDIATE corrective re-dispatch
 *             (prompt explains why the attempt died + artifact-first steps)
 *   death 2 → salvage → decomposition dispatch (do NOT do the work; split
 *             into chained single-deliverable subtasks)   [regular only]
 *   death 3 → block with the full diagnosis and actionable next steps
 *
 * Workflow steps skip decomposition (corrective → block): step structure is
 * owned by the workflow engine.
 */
async function handleSessionDeath(input: {
  contentDir: string
  port: number
  state: DispatchState
  task: DispatchTask
  targetAgent: string
  err: RuntimeTurnError
  dispatchKind: 'regular' | 'workflow'
  snapshotColumn: keyof DispatchColumns | null
  threadId?: string
}): Promise<void> {
  const diagnosis = input.err.diagnosis
  if (!input.state.failedDispatches) input.state.failedDispatches = {}
  const prev = input.state.failedDispatches[input.task.id]?.sessionDeath
  const deaths = (prev?.deaths ?? 0) + 1
  const seq = currentSeq(input.task.id)

  const salvagedAssetId = diagnosis.salvagedText
    ? await salvageSessionDeathOutput({
        contentDir: input.contentDir,
        taskId: input.task.id,
        agent: input.targetAgent,
        seq,
        salvagedText: diagnosis.salvagedText,
      })
    : undefined
  const salvagedAssetIds = [...(prev?.salvagedAssetIds ?? []), ...(salvagedAssetId ? [salvagedAssetId] : [])]

  const sizeLabel = diagnosis.completionBytes !== undefined
    ? `${Math.round(diagnosis.completionBytes / 1024)}KB${diagnosis.outputTruncated ? ' (truncated)' : ''}`
    : 'unknown size'
  const auditPayload = {
    id: input.task.id,
    title: input.task.title,
    kind: input.dispatchKind,
    deaths,
    ...stripSalvage(diagnosis),
    ...(salvagedAssetId ? { salvagedAssetId } : {}),
  }
  appendAudit(input.contentDir, 'task.runtime_session_died', input.targetAgent, auditPayload)

  const maxDeaths = input.dispatchKind === 'workflow' ? MAX_SESSION_DEATHS_WORKFLOW : MAX_SESSION_DEATHS_REGULAR
  if (deaths >= maxDeaths) {
    delete input.state.failedDispatches[input.task.id]
    const salvageNote = salvagedAssetIds.length > 0
      ? ` Salvaged partial output: asset(s) ${salvagedAssetIds.join(', ')}.`
      : ''
    const reason = [
      `Runtime session died ${deaths} time(s) before completion.`,
      diagnosis.detail ?? `Session ${diagnosis.sessionStatus ?? 'ended'} after a ${sizeLabel} completion.`,
      diagnosis.lastToolCall ? `Last tool call: ${diagnosis.lastToolCall}.` : '',
      salvageNote,
      'Next step: split this task into smaller single-deliverable subtasks or reduce its scope, then re-dispatch.',
    ].filter(Boolean).join(' ')
    await blockStoredTask(input.task.id, reason)
    await tryAddTaskLog(input.task.id, 'system', `Session died ${deaths} time(s); recovery ladder exhausted. Task blocked for review.`, { sessionDeath: auditPayload })
    appendAudit(input.contentDir, 'task.runtime_failed_blocked', input.targetAgent, auditPayload)
    return
  }

  const stage: SessionDeathState['stage'] = deaths === 1 ? 'corrective' : 'decomposition'
  const existing = input.state.failedDispatches[input.task.id]
  input.state.failedDispatches[input.task.id] = {
    lastAttempt: Date.now(),
    count: existing?.count ?? 0, // session deaths don't burn generic retries
    kind: 'structural',
    sessionDeath: { stage, deaths, lastDiagnosis: stripSalvage(diagnosis), salvagedAssetIds, ...(input.threadId ? { lastRunId: input.threadId } : {}) },
  }

  await tryAddTaskLog(
    input.task.id,
    'system',
    `Runtime session died (${sizeLabel} completion, ${diagnosis.sessionStatus ?? diagnosis.reason}). ${stage === 'corrective' ? 'Re-dispatching with corrective output-discipline guidance.' : 'Dispatching decomposition: the agent will split this task into single-deliverable subtasks.'}${salvagedAssetId ? ` Partial output salvaged as asset ${salvagedAssetId}.` : ''}`,
    { sessionDeath: auditPayload },
  )

  if (input.dispatchKind === 'workflow') {
    // Step re-dispatch happens through the normal in-progress workflow scan
    // (markers were already cleared); the corrective prompt is injected from
    // the persisted sessionDeath state. The task stays inProgress.
    appendAudit(input.contentDir, 'task.corrective_redispatch', input.targetAgent, auditPayload)
    return
  }

  if (input.snapshotColumn === 'inProgress') {
    try {
      await moveStoredTask(input.task.id, 'todo', 'inProgress')
    } catch (err) {
      log.warn('Failed to return task to todo after session death', err, { id: input.task.id })
    }
  }

  appendAudit(
    input.contentDir,
    stage === 'corrective' ? 'task.corrective_redispatch' : 'task.decomposition_dispatched',
    input.targetAgent,
    auditPayload,
  )

  // Immediate ladder re-dispatch — fired after the state lock releases
  // (dispatchSingleTask takes the same lock; calling it inline would
  // deadlock). We know exactly what went wrong and how the next attempt
  // differs; parking the task for the next 5-minute cycle buys nothing.
  // If the timer is lost (process restart) or the dispatch is gate-deferred,
  // the next cycle picks the task up from its persisted sessionDeath state.
  // dispatchSingleTask is imported lazily here to break the static import cycle
  // (single → turns → session-death → single) without any barrel-load wiring.
  // The dynamic import resolves the already-loaded module at re-dispatch time.
  scheduleLadderRedispatch(
    async () => {
      try {
        const { dispatchSingleTask } = await import('./dispatch-single')
        await dispatchSingleTask(input.task.id, input.contentDir, input.port, 'recovery')
      } catch (err) {
        log.error('Session-death ladder re-dispatch failed', err, { id: input.task.id, stage })
      }
    },
    SESSION_DEATH_REDISPATCH_DELAY_MS,
  )
}

export async function reconcileRejectedDispatch(input: {
  contentDir: string
  port: number
  state: DispatchState
  dispatchedSet: Set<string> | null
  task: DispatchTask
  targetAgent: string
  err: unknown
  initialLogCount: number
  logPrefix: string
  dispatchKind: 'regular' | 'workflow'
  /** The failed attempt's runId — recorded on the sessionDeath state so the
   *  corrective prompt can point at its retained run dir. */
  threadId?: string
}): Promise<void> {
  const snapshot = findDispatchTaskSnapshot(input.task.id)
  removeDispatchMarkersForTask(input.state, input.dispatchedSet, input.task.id)

  if (snapshot && taskAlreadyLeftActiveWork(snapshot.column)) {
    delete input.state.failedDispatches?.[input.task.id]
    appendAudit(input.contentDir, 'task.dispatch_failure_ignored', input.targetAgent, {
      id: input.task.id,
      title: input.task.title,
      column: snapshot.column,
      error: formatSanitizedRuntimeFailure(input.err),
    })
    return
  }

  // Diagnosed session deaths take the recovery ladder — never the generic
  // block-or-cooldown paths below.
  if (input.err instanceof RuntimeTurnError) {
    await handleSessionDeath({
      contentDir: input.contentDir,
      port: input.port,
      state: input.state,
      task: input.task,
      targetAgent: input.targetAgent,
      err: input.err,
      dispatchKind: input.dispatchKind,
      snapshotColumn: snapshot?.column ?? null,
      ...(input.threadId ? { threadId: input.threadId } : {}),
    })
    return
  }

  const summary = formatSanitizedRuntimeFailure(input.err)
  if (snapshot?.column === 'inProgress' && shouldBlockAfterDispatchFailure(snapshot, input.initialLogCount)) {
    delete input.state.failedDispatches?.[input.task.id]
    await blockStoredTask(input.task.id, `Agent run ended before reporting completion. ${summary}.`)
    await tryAddTaskLog(input.task.id, 'system', `Agent run ended before task completion: ${summary}. Task moved to blocked for review.`)
    appendAudit(input.contentDir, 'task.runtime_failed_blocked', input.targetAgent, {
      id: input.task.id,
      title: input.task.title,
      kind: input.dispatchKind,
      error: summary,
    })
    return
  }

  if (!input.state.failedDispatches) input.state.failedDispatches = {}
  const prev = getFailureRecord(input.state.failedDispatches[input.task.id])
  const kind = classifyDispatchError(input.err)
  const detail = classifyDispatchFailureDetail(input.err)
  const attempt = (prev?.count || 0) + 1
  // Preserve any in-flight recovery-ladder state: a transport failure
  // between ladder rungs (e.g. the corrective re-dispatch fired while the
  // gateway was still rebooting after the death) must not wipe the stage —
  // otherwise the ladder restarts from scratch and the corrective prompt
  // is lost. Found live during the rig ladder smoke.
  input.state.failedDispatches[input.task.id] = {
    lastAttempt: Date.now(),
    count: attempt,
    kind,
    ...(prev?.sessionDeath ? { sessionDeath: prev.sessionDeath } : {}),
  }

  if (snapshot?.column === 'inProgress') {
    try {
      await moveStoredTask(input.task.id, 'todo', 'inProgress')
    } catch (err) {
      log.warn('Failed to return task to todo after dispatch rejection', err, { id: input.task.id })
    }
  }

  await tryAddTaskLog(
    input.task.id,
    'system',
    `${input.logPrefix} (attempt ${attempt}, ${kind}) → ${input.targetAgent}: ${detail.summary}. Returned to Todo for retry when cooldown expires.`,
    { dispatchFailure: detail },
  )
  appendAudit(input.contentDir, 'task.dispatch_failed', input.targetAgent, {
    id: input.task.id,
    title: input.task.title,
    error: detail.summary,
    attempt,
    kind,
    ...detail,
  })
}
