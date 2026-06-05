/**
 * Task dispatch system for Bakin.
 * Periodically checks for TODO tasks and dispatches them to agents via the runtime adapter.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { createLogger } from './logger'
import { getSettings } from './settings'
import { appendAudit } from './audit'
import { recordUsage } from './usage'
import { getAppServices } from './app-services'
import { getRuntimeMainAgentId, RuntimeError, RuntimeTurnError } from '@bakin/core/adapters/runtime'
import { getHookRegistry } from '../lib/plugin-registry'
import {
  buildTaskLessonQuery,
  formatLessonsForDispatch,
  retrieveAgentPackageLessons,
} from './agent-packages/lesson-retrieval'
import {
  addTaskLog as appendTaskLog,
  blockTask as blockStoredTask,
  moveTask as moveStoredTask,
  readTaskboard,
  updateTask as updateStoredTask,
} from './task-store'

const log = createLogger('dispatch')
const hooks = () => getHookRegistry()
const IMAGE_MCPORTER_TIMEOUT_MS = 600000

/**
 * Task-work sends get a per-dispatch session: a fresh, deterministic
 * threadId per attempt so context can't accumulate across tasks, forensics
 * knows exactly which provider session to inspect, and a corrective
 * re-dispatch never replays a dead session's bloated context. Notification
 * sends (orchestrator/watchdog/doctor) deliberately stay in the agent's
 * default session and don't go through here.
 */
async function sendDispatchMessage(agentId: string, content: string, threadId: string): Promise<void> {
  await getAppServices().runtime.messaging.send({
    agentId,
    content,
    threadId,
    metadata: { oversizedOutputBytes: getSettings().dispatch.oversizedOutputBytes },
  })
}

/**
 * Mint the next per-attempt session key for a task dispatch.
 *
 * `seq` is a monotonic per-task counter persisted immediately — it must
 * never be derived from the failure count (which resets on success and
 * would silently resume a stale session on a later re-dispatch) and must
 * survive a crashed cycle (reusing a seq could re-enter a live session).
 * Workflow steps carry the stepId so parallel step agents can't collide.
 */
function nextDispatchThreadId(contentDir: string, state: DispatchState, taskId: string, stepId?: string): string {
  if (!state.dispatchSeq) state.dispatchSeq = {}
  const seq = (state.dispatchSeq[taskId] ?? 0) + 1
  state.dispatchSeq[taskId] = seq
  saveDispatchState(contentDir, state)
  return stepId ? `task:${taskId}:step:${stepId}:d${seq}` : `task:${taskId}:d${seq}`
}

// Upstream runtime error bodies land in task logs and audit JSONL via
// the dispatch catch handlers. Bound the blast radius — a runaway adapter
// response (HTML error page, stack trace, accidental secret echo) should
// not balloon the audit file or the task drawer.
const MAX_ERR_LEN = 500
function formatDispatchError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.length > MAX_ERR_LEN ? `${raw.slice(0, MAX_ERR_LEN)}… (truncated)` : raw
}

async function buildDispatchLessonBlock(input: {
  contentDir: string
  taskId: string
  title: string
  agentId: string
  query: string
}): Promise<string> {
  try {
    const settings = getSettings().agentPackages?.lessonsRetrieval
    const result = await retrieveAgentPackageLessons({
      contentDir: input.contentDir,
      agentId: input.agentId,
      query: input.query,
      settings,
      requireDispatchInjection: true,
    })
    const block = formatLessonsForDispatch(
      result.lessons,
      settings?.maxCharacters,
    )
    if (result.lessons.length > 0) {
      appendAudit(input.contentDir, 'agent_pkg.lessons_retrieved', input.agentId, {
        taskId: input.taskId,
        title: input.title,
        packageId: result.packageId,
        lessons: result.lessons.map((lesson) => ({
          lessonId: lesson.lessonId,
          title: lesson.title,
          score: lesson.score,
        })),
      })
    }
    return block
  } catch (err) {
    const error = formatDispatchError(err)
    log.warn('Dispatch lesson retrieval failed', { taskId: input.taskId, agentId: input.agentId, error })
    appendAudit(input.contentDir, 'agent_pkg.lessons_retrieval_failed', input.agentId, {
      taskId: input.taskId,
      title: input.title,
      error,
    })
    return ''
  }
}

type DispatchFailureKind = 'transient' | 'structural'
type DispatchFailureReasonCode =
  | 'provider_cooldown'
  | 'auth_profile_unavailable'
  | 'dispatch_timeout'
  | 'transport_failure'
  | 'runtime_adapter_failure'
  | 'runtime_turn_died'
  | 'runtime_dispatch_failed'

interface DispatchFailureDetail {
  category: 'model_provider_unavailable' | 'runtime_unavailable'
  reasonCode: DispatchFailureReasonCode
  summary: string
  specificReason: string
  retryable: boolean
  provider?: string
  model?: string
  cooldownReason?: string
  rawError: string
}

/** Diagnosis evidence persisted across ladder rungs (salvagedText stripped). */
interface SessionDeathDiagnosisLite {
  reason: string
  sessionId?: string
  sessionStatus?: string
  completionBytes?: number
  outputTruncated?: boolean
  oversizedOutput?: boolean
  lastToolCall?: string
  detail?: string
}

/**
 * Recovery-ladder state for a task whose runtime session died. `stage` is
 * what the NEXT dispatch of this task must do: 'corrective' injects the
 * PREVIOUS ATTEMPT FAILED guidance, 'decomposition' replaces the work prompt
 * with split-into-subtasks instructions. Session deaths are deterministic —
 * they never enter the generic cooldown/retry loop.
 */
interface SessionDeathState {
  stage: 'corrective' | 'decomposition'
  deaths: number
  lastDiagnosis: SessionDeathDiagnosisLite
  salvagedAssetIds: string[]
}

interface FailureRecord {
  lastAttempt: number
  count: number
  kind: DispatchFailureKind
  sessionDeath?: SessionDeathState
}

interface DispatchState {
  lastRun: number | null
  serverStart: number
  dispatched: string[]
  failedDispatches: Record<string, FailureRecord>
  /** Monotonic per-task dispatch counter — see nextDispatchThreadId(). */
  dispatchSeq?: Record<string, number>
}

type DispatchTask = {
  id: string
  title: string
  agent?: string
  workflowId?: string
  description?: string
  projectId?: string
  availableAt?: string
  dependsOn?: string
  log?: Array<{ timestamp: string; message?: string }>
}

type DispatchTaskSnapshot = {
  column: keyof DispatchColumns
  task: DispatchTask
}

type DispatchEligibilityContext = {
  nowMs: number
  runtimeAgentIds: Set<string>
  completedTaskIds: Set<string>
  /**
   * Every task id present on the board, any column. When provided, a
   * dependsOn pointing at an id that exists nowhere (hard-deleted by
   * archiveOldTasks) is treated as satisfied instead of stranding the
   * dependent forever — surfaced via `danglingDependency` so callers log it.
   */
  knownTaskIds?: Set<string>
}

export type DispatchIneligibleReason = 'scheduled' | 'dependency' | 'agent'

export type DispatchEligibility =
  | { eligible: true; danglingDependency?: string }
  | { eligible: false; reason: DispatchIneligibleReason }

type DispatchColumns = {
  backlog: DispatchTask[]
  todo: DispatchTask[]
  inProgress: DispatchTask[]
  review: DispatchTask[]
  done: DispatchTask[]
  blocked: DispatchTask[]
  archived: DispatchTask[]
}

function emptyDispatchColumns(): DispatchColumns {
  return {
    backlog: [],
    todo: [],
    inProgress: [],
    review: [],
    done: [],
    blocked: [],
    archived: [],
  }
}

async function readDispatchColumns(): Promise<DispatchColumns> {
  const board = readTaskboard() as unknown as { columns: Partial<DispatchColumns> }
  return { ...emptyDispatchColumns(), ...(board?.columns ?? {}) }
}

export function isTaskDispatchEligible(
  task: DispatchTask,
  context: DispatchEligibilityContext,
): DispatchEligibility {
  if (task.availableAt) {
    const availableMs = Date.parse(task.availableAt)
    if (!Number.isNaN(availableMs) && availableMs > context.nowMs) {
      return { eligible: false, reason: 'scheduled' }
    }
  }

  let danglingDependency: string | undefined
  if (task.dependsOn && !context.completedTaskIds.has(task.dependsOn)) {
    const targetExists = context.knownTaskIds ? context.knownTaskIds.has(task.dependsOn) : true
    if (targetExists) {
      return { eligible: false, reason: 'dependency' }
    }
    danglingDependency = task.dependsOn
  }

  if (task.agent && !context.runtimeAgentIds.has(task.agent)) {
    return { eligible: false, reason: 'agent' }
  }

  return { eligible: true, ...(danglingDependency ? { danglingDependency } : {}) }
}

async function addTaskLog(taskId: string, author: string, message: string, data?: Record<string, unknown>): Promise<void> {
  if (data) await appendTaskLog(taskId, author, message, data)
  else await appendTaskLog(taskId, author, message)
}

async function moveTaskToInProgress(taskId: string, agent: string): Promise<void> {
  await updateStoredTask(taskId, { column: 'inProgress', agent })
}

const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'EPIPE',
])

// Split dispatch failures into:
//   - transient: transport failures (socket drop, disconnect, fetch error)
//     that should clear within a cycle. Use the short cooldown.
//   - structural: the runtime answered and said no, or timed out outright.
//     Use the long cooldown.
//
// Adapters throw typed RuntimeErrors — classification is on `kind` only.
// The structural-signal fallback below (TypeError / AbortError / cause.code)
// exists for non-RuntimeError errors from mock adapters or unexpected paths;
// it never inspects error message text. Default to 'structural' on unknown
// errors: treating an unknown failure as a real outage is the safer side.
export function classifyDispatchError(err: unknown): DispatchFailureKind {
  if (err instanceof RuntimeError) {
    return err.kind === 'transport' ? 'transient' : 'structural'
  }
  if (err instanceof TypeError) return 'transient'
  const cause = (err as { cause?: { code?: string } })?.cause
  if (cause?.code && TRANSIENT_CODES.has(cause.code)) return 'transient'
  if (err instanceof Error && err.name === 'AbortError') return 'transient'
  return 'structural'
}

export function classifyDispatchFailureDetail(err: unknown): DispatchFailureDetail {
  const rawError = formatDispatchError(err)

  if (err instanceof RuntimeError) {
    switch (err.kind) {
      case 'provider_cooldown': {
        const info = err.providerInfo ?? {}
        return {
          category: 'model_provider_unavailable',
          reasonCode: info.authProfileUnavailable ? 'auth_profile_unavailable' : 'provider_cooldown',
          summary: 'Dispatch failed: model provider unavailable',
          specificReason: info.authProfileUnavailable
            ? 'Auth profile unavailable'
            : 'Provider in cooldown after timeout',
          retryable: true,
          ...(info.provider ? { provider: info.provider } : {}),
          ...(info.model ? { model: info.model } : {}),
          ...(info.cooldownReason ? { cooldownReason: info.cooldownReason } : {}),
          rawError,
        }
      }
      case 'timeout':
        return {
          category: 'runtime_unavailable',
          reasonCode: 'dispatch_timeout',
          summary: 'Dispatch failed: runtime dispatch timed out',
          specificReason: 'Runtime dispatch timed out',
          retryable: true,
          rawError,
        }
      case 'transport':
        return {
          category: 'runtime_unavailable',
          reasonCode: 'transport_failure',
          summary: 'Dispatch failed: runtime transport unavailable',
          specificReason: 'Runtime transport failure',
          retryable: true,
          rawError,
        }
      case 'session_death':
        return {
          category: 'runtime_unavailable',
          reasonCode: 'runtime_turn_died',
          summary: 'Dispatch failed: runtime session died before completion',
          specificReason: err instanceof RuntimeTurnError
            ? (err.diagnosis.detail ?? err.message)
            : err.message,
          retryable: false,
          rawError,
        }
      case 'runtime_failed':
        return {
          category: 'runtime_unavailable',
          reasonCode: 'runtime_adapter_failure',
          summary: 'Dispatch failed: runtime adapter failure',
          specificReason: 'Runtime adapter failure',
          retryable: true,
          rawError,
        }
    }
  }

  if (err instanceof TypeError || (err instanceof Error && err.name === 'AbortError')) {
    return {
      category: 'runtime_unavailable',
      reasonCode: 'transport_failure',
      summary: 'Dispatch failed: runtime transport unavailable',
      specificReason: 'Runtime transport failure',
      retryable: true,
      rawError,
    }
  }

  return {
    category: 'runtime_unavailable',
    reasonCode: 'runtime_dispatch_failed',
    summary: 'Dispatch failed: runtime dispatch failed before task completion',
    specificReason: 'Runtime dispatch failed before task completion',
    retryable: true,
    rawError,
  }
}

let dispatching = false
let dispatchStartedAt = 0
let dispatchTimer: NodeJS.Timeout | null = null
const DISPATCH_TIMEOUT_MS = 3 * 60 * 1000 // 3 minutes max per dispatch cycle

// Async mutex for .dispatch-state.json — serializes all reads/writes
let stateQueue = Promise.resolve() as Promise<unknown>
function withStateLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const next = stateQueue.then(fn, fn) as Promise<T>
  stateQueue = next.then(() => {}, () => {})
  return next
}

function getStateFile(contentDir: string): string {
  return join(contentDir, '.dispatch-state.json')
}

function getFailureRecord(entry: FailureRecord | undefined): FailureRecord | null {
  if (!entry) return null
  return { ...entry, kind: entry.kind ?? 'structural' }
}

function cooldownForFailure(
  failure: FailureRecord,
  settings: { dispatch: { transientCooldownMs: number; failureCooldownMs: number } },
): number {
  return failure.kind === 'transient'
    ? settings.dispatch.transientCooldownMs
    : settings.dispatch.failureCooldownMs
}

function getDispatchMarkerTaskId(marker: string): string {
  const separator = marker.indexOf(':')
  return separator === -1 ? marker : marker.slice(0, separator)
}

function removeDispatchMarkersForTask(
  state: DispatchState,
  dispatchedSet: Set<string> | null,
  taskId: string,
): void {
  state.dispatched = state.dispatched.filter(marker => getDispatchMarkerTaskId(marker) !== taskId)
  if (dispatchedSet) {
    for (const marker of Array.from(dispatchedSet)) {
      if (getDispatchMarkerTaskId(marker) === taskId) dispatchedSet.delete(marker)
    }
  }
}

function findDispatchTaskSnapshot(taskId: string): DispatchTaskSnapshot | null {
  const { columns } = readTaskboard() as unknown as { columns: DispatchColumns }
  for (const column of Object.keys(emptyDispatchColumns()) as Array<keyof DispatchColumns>) {
    const task = columns[column]?.find(t => t.id === taskId)
    if (task) return { column, task }
  }
  return null
}

function taskAlreadyLeftActiveWork(column: keyof DispatchColumns): boolean {
  return column === 'done' || column === 'blocked' || column === 'review' || column === 'archived'
}

async function tryAddTaskLog(taskId: string, author: string, message: string, data?: Record<string, unknown>): Promise<void> {
  try {
    if (data) await addTaskLog(taskId, author, message, data)
    else await addTaskLog(taskId, author, message)
  } catch (err) {
    log.warn('Failed to append dispatch reconciliation task log', err, { id: taskId })
  }
}

export function formatSanitizedRuntimeFailure(err: unknown): string {
  if (err instanceof RuntimeTurnError) {
    return err.diagnosis.detail ?? err.message
  }
  if (err instanceof RuntimeError) {
    switch (err.kind) {
      case 'timeout': return 'runtime gateway request timed out'
      case 'transport': return 'runtime transport failure'
      case 'provider_cooldown': return 'model provider unavailable'
      case 'session_death': return err.message
      case 'runtime_failed': return 'runtime adapter failure'
    }
  }
  if (err instanceof Error && err.name === 'AbortError') return 'runtime transport request aborted'
  return 'runtime dispatch failed before task completion'
}

function shouldBlockAfterDispatchFailure(
  snapshot: DispatchTaskSnapshot,
  initialLogCount: number,
): boolean {
  return (snapshot.task.log?.length ?? 0) > initialLogCount
}

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
}): Promise<void> {
  const diagnosis = input.err.diagnosis
  if (!input.state.failedDispatches) input.state.failedDispatches = {}
  const prev = input.state.failedDispatches[input.task.id]?.sessionDeath
  const deaths = (prev?.deaths ?? 0) + 1
  const seq = input.state.dispatchSeq?.[input.task.id] ?? 0

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
    sessionDeath: { stage, deaths, lastDiagnosis: stripSalvage(diagnosis), salvagedAssetIds },
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
  const timer = setTimeout(() => {
    dispatchSingleTask(input.task.id, input.contentDir, input.port, 'recovery').catch((err) => {
      log.error('Session-death ladder re-dispatch failed', err, { id: input.task.id, stage })
    })
  }, SESSION_DEATH_REDISPATCH_DELAY_MS)
  timer.unref?.()
}

async function reconcileRejectedDispatch(input: {
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
  input.state.failedDispatches[input.task.id] = { lastAttempt: Date.now(), count: attempt, kind }

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

// ─── In-flight turn registry (concurrent dispatch) ─────────────────────────
//
// Sends are fired and tracked, never awaited inside the dispatch cycle: one
// 10-minute turn must not stall dispatching to every other agent (the
// serial-await loop was why parallel task fan-out made no independent
// progress). Reconciliation happens in per-turn settle handlers that take
// the state lock themselves. The registry is advisory — caps + settle
// bookkeeping — never a source of truth for task state; restart safety is
// unchanged (in-flight promises die with the process, restart-recovery
// handles orphaned inProgress tasks via heartbeats).

interface InFlightTurn {
  agentId: string
  taskId: string
  threadId: string
  startedAt: number
  /** Full send + settle chain; resolves when reconciliation has finished. */
  settled: Promise<void>
}

const inFlightTurns = new Map<string, InFlightTurn>()

export function getInFlightTurnCount(agentId?: string): number {
  if (!agentId) return inFlightTurns.size
  let count = 0
  for (const turn of inFlightTurns.values()) {
    if (turn.agentId === agentId) count += 1
  }
  return count
}

export type ConcurrencyGate = 'concurrency_cap' | 'agent_busy' | null

/** Why a dispatch can't fire right now, or null when a slot is free. */
function concurrencyGate(agentId: string, settings: { dispatch: { maxConcurrentTurns: number; maxTurnsPerAgent: number } }): ConcurrencyGate {
  if (inFlightTurns.size >= settings.dispatch.maxConcurrentTurns) return 'concurrency_cap'
  if (getInFlightTurnCount(agentId) >= settings.dispatch.maxTurnsPerAgent) return 'agent_busy'
  return null
}

/**
 * Wait until every tracked turn (including its settle-time reconciliation)
 * has finished. Deterministic synchronization point for tests and shutdown.
 */
export async function awaitDispatchIdle(): Promise<void> {
  while (inFlightTurns.size > 0) {
    await Promise.allSettled([...inFlightTurns.values()].map((turn) => turn.settled))
  }
}

/**
 * Fire a dispatch send and reconcile on settle. Returns immediately. The
 * settle handlers re-load state under the lock — the firing cycle's state
 * object must not be touched after the cycle's own save.
 */
function fireDispatchTurn(opts: {
  marker: string
  task: DispatchTask
  targetAgent: string
  threadId: string
  message: string
  contentDir: string
  port: number
  initialLogCount: number
  logPrefix: string
  dispatchKind: 'regular' | 'workflow'
  onSettled?: (outcome: 'ok' | 'error', err?: unknown) => void
}): void {
  // The registry entry is released only AFTER settle reconciliation
  // completes — awaitDispatchIdle() must mean "all bookkeeping done", and a
  // turn's slot shouldn't free until its outcome has been recorded.
  const settled = sendDispatchMessage(opts.targetAgent, opts.message, opts.threadId)
    .then(async () => {
      await withStateLock(() => {
        const state = loadDispatchState(opts.contentDir)
        if (state.failedDispatches?.[opts.task.id]) {
          delete state.failedDispatches[opts.task.id]
          saveDispatchState(opts.contentDir, state)
        }
      })
      opts.onSettled?.('ok')
    })
    .catch(async (err) => {
      log.error(`${opts.logPrefix}: turn failed for "${opts.task.title}" → ${opts.targetAgent}`, err)
      try {
        await withStateLock(async () => {
          const state = loadDispatchState(opts.contentDir)
          await reconcileRejectedDispatch({
            contentDir: opts.contentDir,
            port: opts.port,
            state,
            dispatchedSet: null,
            task: opts.task,
            targetAgent: opts.targetAgent,
            err,
            initialLogCount: opts.initialLogCount,
            logPrefix: opts.logPrefix,
            dispatchKind: opts.dispatchKind,
          })
          saveDispatchState(opts.contentDir, state)
        })
      } catch (reconcileErr) {
        log.error('Dispatch settle reconciliation failed', reconcileErr, { id: opts.task.id })
      }
      opts.onSettled?.('error', err)
    })
    .finally(() => {
      inFlightTurns.delete(opts.marker)
    })

  inFlightTurns.set(opts.marker, {
    agentId: opts.targetAgent,
    taskId: opts.task.id,
    threadId: opts.threadId,
    startedAt: Date.now(),
    settled,
  })
}

/** Shared dispatched[] cap — both dispatch paths must honor the setting. */
function trimDispatched(state: DispatchState, maxDispatched: number): void {
  if (state.dispatched.length > maxDispatched) {
    state.dispatched = state.dispatched.slice(-maxDispatched)
  }
}

export function loadDispatchState(contentDir: string): DispatchState {
  const stateFile = getStateFile(contentDir)
  try {
    if (existsSync(stateFile)) {
      const parsed = JSON.parse(readFileSync(stateFile, 'utf-8'))
      if (!Array.isArray(parsed.dispatched)) parsed.dispatched = []
      if (!parsed.failedDispatches || typeof parsed.failedDispatches !== 'object') parsed.failedDispatches = {}
      if (!parsed.dispatchSeq || typeof parsed.dispatchSeq !== 'object') parsed.dispatchSeq = {}
      return parsed
    }
  } catch (err) {
    log.warn('Failed to read dispatch state', err)
  }
  return { lastRun: null, serverStart: Date.now(), dispatched: [], failedDispatches: {} }
}

function saveDispatchState(contentDir: string, state: DispatchState): void {
  writeFileSync(getStateFile(contentDir), JSON.stringify(state, null, 2), 'utf-8')
}

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
      const needsDispatch = activeAgents.some(({ stepId }) => !dispatchedSet.has(`${task.id}:${stepId}`))
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

      // Workflow-aware dispatch path
      const taskWithWorkflow = task as typeof task & { workflowId?: string }
      if (taskWithWorkflow.workflowId) {
        try {
          await dispatchWorkflowTask({ ...taskWithWorkflow, workflowId: taskWithWorkflow.workflowId }, contentDir, port, dispatchedSet, state, moveTaskToInProgress, addTaskLog, mainAgentId)
        } catch (err) {
          log.error(`Failed to dispatch workflow task "${task.title}"`, err)
        }
        continue
      }

      const targetAgent = task.agent ?? mainAgentId

      // Bounded concurrency: a capped task is simply ineligible this cycle
      // (no failure recorded) — a later cycle picks it up when a slot frees.
      const gate = concurrencyGate(targetAgent, settings)
      if (gate) {
        log.debug('Dispatch deferred by concurrency gate', { id: task.id, agent: targetAgent, gate })
        continue
      }

      const lessonBlock = await buildDispatchLessonBlock({
        contentDir,
        taskId: task.id,
        title: task.title,
        agentId: targetAgent,
        query: buildTaskLessonQuery(task),
      })
      const recovery = failure?.sessionDeath
      const message = recovery?.stage === 'decomposition'
        ? buildDecompositionMessage(task, targetAgent, recovery)
        : buildDispatchMessage(task, targetAgent, contentDir, mainAgentId, lessonBlock, {}, recovery, runtimeRoster)
      const initialLogCount = task.log?.length ?? 0

      // Move to inProgress BEFORE sending message to eliminate race condition
      // where fast agents complete before dispatch moves the task
      await moveTaskToInProgress(task.id, targetAgent)
      appendAudit(contentDir, 'task.moved', 'dispatch', { id: task.id, title: task.title, from: 'todo', to: 'inProgress' })

      const threadId = nextDispatchThreadId(contentDir, state, task.id)
      dispatchedSet.add(task.id)
      appendAudit(contentDir, 'task.dispatched', targetAgent, { id: task.id, title: task.title, threadId })
      log.info('Task dispatched', { id: task.id, title: task.title, agent: targetAgent, threadId })
      fireDispatchTurn({
        marker: task.id,
        task,
        targetAgent,
        threadId,
        message,
        contentDir,
        port,
        initialLogCount,
        logPrefix: 'Dispatch failed',
        dispatchKind: 'regular',
      })
    }

    state.lastRun = Date.now()
    state.dispatched = [...dispatchedSet]
    trimDispatched(state, settings.dispatch.maxDispatched)
    saveDispatchState(contentDir, state)
    }) // end withStateLock
  } finally {
    dispatching = false
  }
}

/**
 * Immediately dispatch a single task by ID, bypassing the 5-minute cycle.
 * Used for kick (explicit) and auto-kick (subtask with parentId).
 */
/**
 * Remove a task's dispatch markers so an immediate re-dispatch (e.g.
 * dependency continuation) isn't skipped as "already dispatched" before the
 * next cycle reconciles markers against the board.
 */
export async function clearDispatchMarker(contentDir: string, taskId: string): Promise<void> {
  await withStateLock(() => {
    const state = loadDispatchState(contentDir)
    removeDispatchMarkersForTask(state, null, taskId)
    saveDispatchState(contentDir, state)
  })
}

export interface DispatchContinuationContext {
  completedDependency?: { id: string; title: string }
}

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
      log.debug('dispatchSingleTask: deferred by concurrency gate', { taskId, agent: targetAgent, gate })
      return
    }

    const lessonBlock = await buildDispatchLessonBlock({
      contentDir,
      taskId: task.id,
      title: task.title,
      agentId: targetAgent,
      query: buildTaskLessonQuery(task),
    })
    const recovery = failure?.sessionDeath
    const message = recovery?.stage === 'decomposition'
      ? buildDecompositionMessage(task, targetAgent, recovery)
      : buildDispatchMessage(task, targetAgent, contentDir, mainAgentId, lessonBlock, continuation, recovery, runtimeRoster)
    const dispatchStart = Date.now()
    const initialLogCount = task.log?.length ?? 0

    // Move to inProgress BEFORE sending message to eliminate race condition
    await moveTaskToInProgress(task.id, targetAgent)
    appendAudit(contentDir, 'task.moved', 'dispatch', { id: task.id, title: task.title, from: 'todo', to: 'inProgress' })

    const threadId = nextDispatchThreadId(contentDir, state, task.id)
    state.dispatched.push(task.id)
    trimDispatched(state, settings.dispatch.maxDispatched)
    saveDispatchState(contentDir, state)

    appendAudit(contentDir, 'task.dispatched', targetAgent, { id: task.id, title: task.title, threadId })
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

function mcporterHelpers(agentName: string) {
  const server = `bakin-${agentName}`
  return {
    server,
    mc: (tool: string, args: string) => `mcporter call ${server}.${tool} ${args}`,
    mcImage: (tool: string, args: string) => `mcporter call ${server}.${tool} --timeout ${IMAGE_MCPORTER_TIMEOUT_MS} ${args}`,
  }
}

/**
 * Shared execution-tool documentation — single source so the regular and
 * workflow prompt builders cannot drift. Intentional differences (e.g.
 * channel posting only for output steps) are explicit parameters.
 */
function sharedExecutionToolDocs(agentName: string, taskId: string, opts: { allowChannelPost: boolean }): string[] {
  const { mc, mcImage } = mcporterHelpers(agentName)
  const lines = [
    '# Save any file as a managed asset (handles naming + sidecar metadata)',
    mc('bakin_exec_assets_save', `taskId=${taskId} type=<images|text|video|audio|plans|data|other> filePath="<path>" description="<what it is>"`),
    '',
    '# Recommend and generate an image through the core images plugin',
    mc('bakin_exec_images_recommend', 'surface=instagram-feed-portrait objective="<goal>"'),
    mcImage('bakin_exec_images_generate', `taskId=${taskId} prompt="<text>" surface=instagram-feed-portrait provider=auto`),
    '',
    '# Check workflow gate statuses',
    mc('bakin_exec_check_gates', `taskId=${taskId}`),
  ]
  if (opts.allowChannelPost) {
    lines.push(
      '',
      '# Post to a runtime channel (with optional image/video attachment)',
      mc('bakin_exec_post_channel', `channel="<name>" content="<message>" taskId=${taskId}`),
    )
  }
  return lines
}

/**
 * The prevention half of session-death hardening: artifact-first output
 * rules injected into EVERY dispatch prompt. Oversized chat completions are
 * what kill runtime sessions — deliverables belong in files/assets, produced
 * one at a time, with chat reserved for short status.
 */
function outputDisciplineSection(agentName: string, taskId: string, opts: { subtasksAllowed: boolean }): string[] {
  const { mc } = mcporterHelpers(agentName)
  return [
    '## OUTPUT DISCIPLINE — MANDATORY',
    '',
    'Oversized chat output KILLS your runtime session and fails the task — the runtime cannot deliver large completions. Hard rules:',
    '',
    `- Any deliverable or output larger than ~8KB MUST be written to a workspace file and saved BEFORE you continue: \`${mc('bakin_exec_assets_save', `taskId=${taskId} type=<type> filePath="<path>" description="<what it is>"`)}\``,
    '- Multiple deliverables = a checklist. Produce them ONE AT A TIME: write the file → save it as an asset → log progress → start the next. NEVER draft several deliverables in a single response.',
    '- Keep every chat/completion message short: status, decisions, and asset ids — never deliverable content.',
    opts.subtasksAllowed
      ? '- If deliverables are independent and numerous, split them into subtasks (see DEPENDENCY PATTERN below) instead of doing them all in one turn.'
      : '- If your step output is large, save it as an asset first and reference the asset id in your submitted step output instead of inlining the content.',
  ]
}

/**
 * Corrective guidance injected at the TOP of a re-dispatch prompt after a
 * session death (position primacy — the agent must read this before the
 * task). Explains WHY the previous attempt died and how this one differs.
 */
function buildCorrectiveSection(taskId: string, recovery: SessionDeathState): string {
  const d = recovery.lastDiagnosis
  const sizeLabel = d.completionBytes !== undefined
    ? `~${Math.round(d.completionBytes / 1024)}KB`
    : 'too much'
  const salvageLine = recovery.salvagedAssetIds.length > 0
    ? `\nA partial copy of that output was salvaged as asset ${recovery.salvagedAssetIds.join(', ')} — open it with bakin_exec_assets_open and REUSE it instead of regenerating from scratch.`
    : ''
  return `## PREVIOUS ATTEMPT FAILED — READ FIRST
Your previous attempt on this task died before completion: ${d.detail ?? `the runtime session ended (${d.sessionStatus ?? d.reason})`}. The session was killed because ${sizeLabel} of output was emitted as chat text instead of being written to files — the runtime cannot deliver responses that large.${salvageLine}

Do this attempt differently:
- Produce deliverables ONE AT A TIME: write each to a workspace file, then immediately save it: bakin_exec_assets_save taskId=${taskId} type=<type> filePath="<path>" description="<what it is>"
- Log progress after each save, then move to the next deliverable.
- Keep every chat/completion message SHORT: status + asset ids only. NEVER put deliverable content in chat output.

`
}

/**
 * Decomposition dispatch (recovery-ladder rung 2): the agent must NOT do the
 * work — only split it into chained single-deliverable subtasks. Emitting a
 * handful of tool calls is a tiny output, the structural opposite of the
 * failure being recovered from.
 */
function buildDecompositionMessage(
  task: { id: string; title: string; description?: string },
  agentName: string,
  recovery: SessionDeathState,
): string {
  const server = `bakin-${agentName}`
  const mc = (tool: string, args: string) => `mcporter call ${server}.${tool} ${args}`
  const d = recovery.lastDiagnosis
  const detailsBlock = task.description ? `\n\nOriginal task details:\n${task.description}` : ''
  const salvageBlock = recovery.salvagedAssetIds.length > 0
    ? `\n\nSalvaged partial output from the failed attempts is saved as asset ${recovery.salvagedAssetIds.join(', ')} (open with bakin_exec_assets_open). Use it to determine which deliverables are already partially done and reference it in the subtask descriptions.`
    : ''

  return `## DECOMPOSITION REQUIRED — DO NOT DO THE WORK

Task "${task.title}" (ID: ${task.id}) has failed ${recovery.deaths} times because the runtime session died mid-attempt${d.oversizedOutput ? ' from oversized chat output' : ''}. Producing everything in one turn does not work. Your ONLY job right now is to split it into subtasks — do NOT produce any deliverable content in this turn.${detailsBlock}${salvageBlock}

Steps:
1. Identify the distinct deliverables this task requires (a checklist).
2. Create one subtask per deliverable, in order:
   \`${mc('bakin_exec_tasks_create', `title="<deliverable>" parentId=${task.id} agent=${agentName} description="Produce <deliverable>. Write it to a file and save it with bakin_exec_assets_save taskId=${task.id} (link assets to the PARENT task so the final review sees them). Keep chat output short."`)}\`
3. Chain them so they run one at a time: for every subtask after the first, \`${mc('bakin_exec_tasks_set_dependency', 'taskId=<subtask> dependsOn=<previous subtask>')}\`. Then make THIS task wait for the chain: \`${mc('bakin_exec_tasks_set_dependency', `taskId=${task.id} dependsOn=<last subtask>`)}\` — it will re-dispatch automatically for final assembly when the chain completes.
4. Log what you created: \`${mc('bakin_exec_tasks_log_progress', `taskId=${task.id} message="Decomposed into N subtasks: <ids>"`)}\`
5. STOP. Do not start any subtask, do not draft content, do not call tasks_complete.`
}

export interface DispatchRosterAgent {
  id: string
  role?: string
}

/** @internal Exported for testing. */
export function buildDispatchMessage(
  task: { id: string; title: string; description?: string; agent?: string; projectId?: string },
  agentName: string,
  contentDir: string,
  mainAgentId = 'main',
  lessonBlock = '',
  continuation: DispatchContinuationContext = {},
  recovery?: SessionDeathState,
  roster: DispatchRosterAgent[] = [],
): string {
  const correctivePrefix = recovery?.stage === 'corrective' ? buildCorrectiveSection(task.id, recovery) : ''
  const detailsBlock = task.description ? `\n\nDetails:\n${task.description}` : ''
  const lessonSection = lessonBlock ? `\n\n${lessonBlock}` : ''
  // Dependency continuations run in a fresh session — the prompt must carry
  // the completion context the old shared-session resume nudge relied on.
  const continuationBlock = continuation.completedDependency
    ? `\n\n## Completed Dependency\nYour dependency task "${continuation.completedDependency.title}" (task ${continuation.completedDependency.id}) is now done. Review its outcome before resuming: \`bakin_exec_tasks_get taskId=${continuation.completedDependency.id}\` shows its log and completion summary, and its saved assets are linked to that task. Continue this task from where it left off.`
    : ''

  // List attached assets by filename (stable identity). Agents open them
  // via bakin_exec_assets_open — disk paths are a view, not identity.
  // Under filename-as-identity, every asset lives under
  // assets/store/{YYYY-MM}/; the sidecar's taskId is the link.
  let assetsBlock = ''
  try {
    const storeRoot = join(contentDir, 'assets', 'store')
    const filenames: string[] = []
    if (existsSync(storeRoot)) {
      for (const month of readdirSync(storeRoot)) {
        if (month.startsWith('.')) continue
        const monthDir = join(storeRoot, month)
        let metas: string[]
        try { metas = readdirSync(monthDir).filter(f => f.endsWith('.meta.json')) } catch { continue }
        for (const metaFile of metas) {
          try {
            const meta = JSON.parse(readFileSync(join(monthDir, metaFile), 'utf-8'))
            if (meta.taskId !== task.id) continue
            const assetFilename = metaFile.replace(/\.meta\.json$/, '')
            if (assetFilename.includes('.thumb.') || assetFilename.includes('.opt.')) continue
            filenames.push(assetFilename)
          } catch { /* skip unreadable sidecars */ }
        }
      }
    }
    if (filenames.length > 0) {
      assetsBlock = `\n\n## Attached Assets\nThis task has ${filenames.length} linked asset(s). Review them for context before starting:\n${filenames.map(f => `- ${f}`).join('\n')}\nCall bakin_exec_assets_open with the filename to read the current content + sidecar metadata. Filenames are stable identity — do not store raw disk paths.`
    }
  } catch { /* assets directory may not exist */ }

  // Project context — lightweight mention if task has a projectId
  let projectBlock = ''
  if (task.projectId) {
    projectBlock = `\n\n**Project:** id ${task.projectId}\nThe project spec may contain detailed requirements. Call bakin_exec_projects_get to read it before starting work.`
  }
  const contactsRef = `Reference info is in ${join(contentDir, 'team/CONTACTS.md')}.`

  const { server, mc } = mcporterHelpers(agentName)

  if (!task.agent) {
    // Roster comes from the live runtime — never a hardcoded agent list
    // (custom-agent installs broke against baked-in names).
    const rosterAgents = roster.filter((a) => a.id !== mainAgentId)
    const rosterText = rosterAgents.length > 0
      ? ` (${rosterAgents.map((a) => (a.role ? `${a.id}=${a.role}` : a.id)).join(', ')})`
      : ''
    return `${correctivePrefix}Triage this task: "${task.title}".${detailsBlock}${continuationBlock}${assetsBlock}${lessonSection}\n\nEither handle it yourself or assign it to the right agent${rosterText} via \`${mc('bakin_exec_tasks_assign', `taskId=${task.id} agent="<agent>"`)}\`. ${contactsRef}\n\nLog progress: \`${mc('bakin_exec_tasks_log_progress', `taskId=${task.id} message="<update>"`)}\``
  }

  if (task.agent === mainAgentId) {
    return `${correctivePrefix}Work on this task: "${task.title}".${detailsBlock}${continuationBlock}${assetsBlock}${lessonSection}\n\n${contactsRef} When done: \`${mc('bakin_exec_tasks_complete', `taskId=${task.id} summary="<what you did>"`)}\`\n\nLog progress: \`${mc('bakin_exec_tasks_log_progress', `taskId=${task.id} message="<update>"`)}\``
  }

  return `${correctivePrefix}Work on this task: "${task.title}".${detailsBlock}${continuationBlock}${assetsBlock}${projectBlock}${lessonSection}

## PROGRESS LOGGING — MANDATORY

You MUST log your progress at EVERY major step — not just start and done. These updates appear in the live activity feed so humans can monitor your work in real-time.

Required log points:
- Log at task start: what you are about to do and your approach
- Log after each major step (reading files, planning, each significant code change, after build)
- Share your reasoning and decisions as you go
- Log if blocked or anything unexpected happens
- Log on completion with a full summary
- If you have not logged in the last 2 minutes, log a status update — even if just "still working on X"

For Patch using Claude Code: log before spawning the agent, and after it completes.

${outputDisciplineSection(agentName, task.id, { subtasksAllowed: true }).join('\n')}

## BAKIN TOOLS — via mcporter

All Bakin interactions use mcporter. Your server is \`${server}\`.

\`\`\`bash
# Log progress (mandatory, every major step)
${mc('bakin_exec_tasks_log_progress', `taskId=${task.id} message="<what you did or are doing>"`)}

# Report complete (when finished — includes summary + notifies orchestrator)
${mc('bakin_exec_tasks_complete', `taskId=${task.id} summary="<what you accomplished>"`)}

# Block task (if stuck or cannot proceed)
${mc('bakin_exec_tasks_block', `taskId=${task.id} reason="<what went wrong>"`)}

# Create subtask for another agent
${mc('bakin_exec_tasks_create', `title="<subtask>" assignee="<agent>" description="<brief>" parentId=${task.id}`)}

# Register dependency (then stop — you'll be re-dispatched)
${mc('bakin_exec_tasks_set_dependency', `taskId=${task.id} dependsOn="<other-task-id>"`)}

# Check your task details
${mc('bakin_exec_tasks_get', `taskId=${task.id}`)}

# Find content directories (assets, team, etc.)
${mc('bakin_exec_get_paths', '')}
\`\`\`

## EXECUTION TOOLS — for doing actual work

These tools help you accomplish the work. Use them as your primary way to save files, post content, and generate assets.

\`\`\`bash
${sharedExecutionToolDocs(agentName, task.id, { allowChannelPost: true }).join('\n')}
${task.projectId ? `
# Project tools (this task is part of a project)
${mc('bakin_exec_projects_get', `projectId="${task.projectId}"`)}
${mc('bakin_exec_projects_mark_item', `projectId="${task.projectId}" taskItemId="<itemId>" checked=true`)}
${mc('bakin_exec_projects_add_item', `projectId="${task.projectId}" title="<item title>"`)}` : `
# Projects: bakin_exec_projects_list, bakin_exec_projects_create, bakin_exec_projects_get`}
\`\`\`

## DEPENDENCY PATTERN

If your task requires output from another agent:
1. Create their task with bakin_exec_tasks_create (use parentId for immediate dispatch)
2. Register the dependency with bakin_exec_tasks_set_dependency
3. Stop — you will be automatically re-dispatched when their task completes`
}

export function start(contentDir: string, port: number): void {
  const settings = getSettings()
  dispatchTimer = setInterval(() => {
    dispatchTasks(contentDir, port).catch(err => {
      log.error('Dispatch cycle failed', err)
      appendAudit(contentDir, 'system.dispatch_error', 'system', { error: err instanceof Error ? err.message : String(err) })
    })
  }, settings.dispatch.intervalMs)
  log.info('Dispatch started', { intervalMs: settings.dispatch.intervalMs })
}

export function stop(): void {
  if (dispatchTimer) {
    clearInterval(dispatchTimer)
    dispatchTimer = null
    log.info('Dispatch stopped')
  }
}

/**
 * Dispatch a workflow-backed task. Creates an instance if needed,
 * then sends only the current step's instructions to the assigned agent.
 */
async function dispatchWorkflowTask(
  task: { id: string; title: string; description?: string; agent?: string; workflowId: string },
  contentDir: string,
  port: number,
  dispatchedSet: Set<string>,
  state: DispatchState,
  moveTaskToInProgress: (id: string, agent: string) => Promise<void>,
  addTaskLog: (id: string, author: string, message: string) => Promise<void>,
  mainAgentId: string,
): Promise<void> {
  // Load or create workflow instance.
  // Pass the task assignee so $assigned steps resolve to whoever owns the task at start time.
  const instance = await hooks().invoke<Record<string, unknown>>('workflows.loadInstance', { taskId: task.id })
  if (!instance) {
    await hooks().invoke<Record<string, unknown>>('workflows.createInstance', { taskId: task.id, workflowId: task.workflowId, assignee: task.agent })
    log.info('Created workflow instance', { taskId: task.id, workflowId: task.workflowId, resolvedAgent: task.agent })
  } else if (!instance.resolvedAgent && task.agent) {
    // Backfill resolvedAgent if instance was created before $assigned resolution was wired up
    instance.resolvedAgent = task.agent
    await hooks().invoke<void>('workflows.saveInstance', { instance })
    log.info('Backfilled resolvedAgent on existing instance', { taskId: task.id, resolvedAgent: task.agent })
  }

  // Get agents for current step
  const activeAgents = await hooks().invoke<Array<{ agent: string; stepId: string; effectiveTaskId?: string }>>('workflows.getActiveAgents', { taskId: task.id }) ?? []
  if (activeAgents.length === 0) {
    log.debug('No active agents for workflow step', { taskId: task.id })
    return
  }

  // Move task to in_progress BEFORE dispatching to agents — same pattern as
  // non-workflow tasks. Prevents the task from sitting in "todo" while the
  // agent is already working on it.
  if (!dispatchedSet.has(task.id)) {
    const { columns: fresh } = readTaskboard() as unknown as { columns: Record<string, Array<{ id: string; agent?: string; title?: string; workflowId?: string }>> }
    const stillInTodo = fresh.todo.some(t => t.id === task.id)
    if (stillInTodo) {
      const ownerAgent = task.agent || activeAgents[0]?.agent || mainAgentId
      await moveTaskToInProgress(task.id, ownerAgent)
      appendAudit(contentDir, 'task.moved', 'dispatch', { id: task.id, title: task.title, from: 'todo', to: 'inProgress' })
    }
    dispatchedSet.add(task.id)
  }

  for (const { agent, stepId, effectiveTaskId } of activeAgents) {
    // For nested workflows, use the child's taskId for step context resolution
    const contextTaskId = effectiveTaskId || task.id
    const stepContext = await hooks().invoke<Record<string, unknown>>('workflows.getCurrentStep', { taskId: contextTaskId, agentId: agent })
    if (!stepContext || 'status' in stepContext && (stepContext.status === 'complete' || stepContext.status === 'pending_approval')) {
      continue
    }

    const ctx = stepContext as {
      stepId: string; label: string; type?: string; instructions?: string;
      output_schema?: Record<string, unknown>; rejectionReason?: string;
      previousOutput?: Record<string, unknown>; priorStepOutput?: Record<string, unknown>;
      stepOutputs?: Record<string, Record<string, unknown>>; deny_tools?: string[]
    }
    const targetAgent = agent
    const lessonBlock = await buildDispatchLessonBlock({
      contentDir,
      taskId: task.id,
      title: task.title,
      agentId: targetAgent,
      query: buildTaskLessonQuery({
        title: task.title,
        description: task.description,
        instructions: ctx.instructions,
        context: ctx.label,
      }),
    })
    // Pass contextTaskId so the step/complete API targets the right instance.
    // A pending session-death recovery injects corrective guidance (workflow
    // steps only get the corrective rung — the engine owns step structure).
    const wfRecovery = getFailureRecord(state.failedDispatches?.[task.id])?.sessionDeath
    const message = buildWorkflowDispatchMessage({ ...task, id: contextTaskId }, ctx, agent, lessonBlock, wfRecovery)
    const initialLogCount = findDispatchTaskSnapshot(task.id)?.task.log?.length ?? 0

    const gate = concurrencyGate(targetAgent, getSettings())
    if (gate) {
      log.debug('Workflow step dispatch deferred by concurrency gate', { taskId: task.id, stepId, agent: targetAgent, gate })
      continue
    }

    const threadId = nextDispatchThreadId(contentDir, state, task.id, stepId)
    dispatchedSet.add(`${task.id}:${stepId}`)
    appendAudit(contentDir, 'task.dispatched', targetAgent, {
      id: task.id,
      title: task.title,
      workflowId: task.workflowId,
      stepId,
      threadId,
    })
    log.info('Workflow step dispatched', { taskId: task.id, stepId, agent: targetAgent, threadId })
    fireDispatchTurn({
      marker: `${task.id}:${stepId}`,
      task,
      targetAgent,
      threadId,
      message,
      contentDir,
      port,
      initialLogCount,
      logPrefix: `Workflow dispatch failed for step "${stepId}"`,
      dispatchKind: 'workflow',
    })
  }
}

/**
 * Build a dispatch message for a workflow step.
 * Contains ONLY the current step instructions — never future steps.
 *
 * Structure: identity frame → hard constraints → revision context → task → output → commands → stop.
 * Rules come BEFORE instructions (position primacy — LLMs weight early text more).
 */
function buildWorkflowDispatchMessage(
  task: { id: string; title: string; description?: string },
  stepContext: {
    stepId: string
    label: string
    type?: string
    instructions?: string
    output_schema?: Record<string, unknown>
    rejectionReason?: string
    previousOutput?: Record<string, unknown>
    priorStepOutput?: Record<string, unknown>
    stepOutputs?: Record<string, Record<string, unknown>>
    deny_tools?: string[]
  },
  agentName: string,
  lessonBlock = '',
  recovery?: SessionDeathState,
): string {
  const lines: string[] = []
  if (recovery?.stage === 'corrective') {
    lines.push(buildCorrectiveSection(task.id, recovery).trimEnd())
    lines.push('')
  }

  // ─── Identity Frame ─────────────────────────────────────────────────
  lines.push('# WORKFLOW STEP ASSIGNMENT')
  lines.push('')
  lines.push('You are executing a single step in a managed workflow. You are NOT a general assistant right now — you are a workflow step executor.')
  lines.push('')
  lines.push(`**Task:** "${task.title}"`)
  if (task.description) {
    lines.push(`**Context:** ${task.description}`)
  }
  lines.push(`**Your step:** ${stepContext.label} (ID: ${stepContext.stepId})`)
  lines.push(`**Your agent name:** ${agentName}`)
  lines.push('')

  // ─── Hard Constraints ───────────────────────────────────────────────
  lines.push('## HARD CONSTRAINTS — violations are rejected server-side')
  lines.push('')
  lines.push('1. **SCOPE:** Do ONLY the work described in "YOUR TASK" below. Nothing more. If the task implies work for another step (e.g., generating images when your step is writing copy), STOP — that belongs to a different agent.')
  lines.push('2. **OUTPUT:** Submit via bakin_exec_submit_step. Describing results in conversation does NOT complete the step. The workflow will not advance.')
  lines.push('3. **SCHEMA:** Your output MUST match the JSON schema below. The server validates it. Missing fields = rejection. Extra fields = rejection. Wrong types = rejection.')
  lines.push('4. **NO SIDE EFFECTS:** Do not create subtasks, dispatch other agents, move the task to Done, or post to any channel. The workflow engine handles ALL downstream handoffs — the next agent is already defined in the workflow and will be dispatched automatically when your step is approved. Creating a subtask would duplicate the workflow\'s job.')
  lines.push('5. **ONE SUBMISSION:** Submit your output once via the API, then stop. Do not continue working after submission.')
  if (stepContext.deny_tools?.length) {
    lines.push(`6. **TOOL RESTRICTIONS:** Do NOT use: ${stepContext.deny_tools.join(', ')}. If this step requires those capabilities, BLOCK the task immediately.`)
  }
  lines.push('')
  lines.push(...outputDisciplineSection(agentName, task.id, { subtasksAllowed: false }))
  lines.push('')

  // ─── Revision Context ───────────────────────────────────────────────
  if (stepContext.rejectionReason) {
    lines.push('## REVISION REQUIRED')
    lines.push('')
    if (stepContext.previousOutput) {
      lines.push('**Previous output (rejected):**')
      lines.push('```json')
      lines.push(JSON.stringify(stepContext.previousOutput, null, 2))
      lines.push('```')
      lines.push('')
    }
    lines.push(`**What to fix:** ${stepContext.rejectionReason}`)
    lines.push('')
    lines.push('You MUST address this specific feedback. Do NOT resubmit unchanged output — the server detects near-duplicate resubmissions and rejects them.')
    lines.push('')
  }

  // ─── Workflow Context (all prior step outputs) ─────────────────────
  if (stepContext.stepOutputs && Object.keys(stepContext.stepOutputs).length > 0) {
    lines.push('## WORKFLOW CONTEXT')
    lines.push('')
    lines.push('All completed step outputs from this workflow. Use as context for your work:')
    lines.push('')
    for (const [sid, output] of Object.entries(stepContext.stepOutputs)) {
      const label = sid === '__parentContext' ? 'Parent Workflow (upstream handoff)' : `Step: ${sid}`
      lines.push(`### ${label}`)
      // Surface parent task metadata prominently for child workflows
      if (sid === '__parentContext' && output && typeof output === 'object') {
        const ctx = output as Record<string, unknown>
        if (ctx._parentTaskTitle) {
          lines.push(`**Parent Task:** ${ctx._parentTaskTitle}`)
        }
        if (ctx._parentTaskDescription) {
          lines.push(`**Description:** ${ctx._parentTaskDescription}`)
        }
        // Show remaining output data (excluding internal metadata keys)
        const rest = Object.fromEntries(Object.entries(ctx).filter(([k]) => !k.startsWith('_parent')))
        if (Object.keys(rest).length > 0) {
          lines.push('```json')
          lines.push(JSON.stringify(rest, null, 2))
          lines.push('```')
        }
      } else {
        lines.push('```json')
        lines.push(JSON.stringify(output, null, 2))
        lines.push('```')
      }
      lines.push('')
    }
  } else if (stepContext.priorStepOutput) {
    lines.push('## PRIOR STEP OUTPUT')
    lines.push('')
    lines.push('The previous step in this workflow produced the following output. Use this as context for your work:')
    lines.push('```json')
    lines.push(JSON.stringify(stepContext.priorStepOutput, null, 2))
    lines.push('```')
    lines.push('')
  }

  if (lessonBlock) {
    lines.push(lessonBlock)
    lines.push('')
  }

  // ─── Task Instructions ──────────────────────────────────────────────
  lines.push('## YOUR TASK')
  lines.push('')
  if (stepContext.instructions) {
    lines.push(stepContext.instructions)
    lines.push('')
  }

  // ─── Required Output ────────────────────────────────────────────────
  if (stepContext.output_schema) {
    lines.push('## REQUIRED OUTPUT')
    lines.push('')
    lines.push('Your output must be valid JSON matching this schema:')
    lines.push('```json')
    lines.push(JSON.stringify(stepContext.output_schema, null, 2))
    lines.push('```')
    lines.push('')
  }

  // ─── Progress Logging ──────────────────────────────────────────────
  lines.push('## PROGRESS LOGGING — MANDATORY')
  lines.push('')
  const { server: wfServer, mc: wfMc } = mcporterHelpers(agentName)

  lines.push('You MUST log your progress throughout this workflow step. These updates appear in the live activity feed so humans can monitor your work in real-time.')
  lines.push('')
  lines.push('**When to log:**')
  lines.push('- IMMEDIATELY when you start working (what you are about to do and your approach)')
  lines.push('- After each significant action (reading files, generating content, making API calls, reviewing output)')
  lines.push('- Share your reasoning ("The brief calls for warm tones, going with golden hour lighting")')
  lines.push('- If anything unexpected happens or you are blocked')
  lines.push('- When you complete and submit your output (summary of what you produced)')
  lines.push('- If more than 2 minutes have passed since your last log, send a status update — even if just "Still working on X, currently Y"')
  lines.push('')

  // ─── Commands ───────────────────────────────────────────────────────
  lines.push('## COMMANDS')
  lines.push('')
  lines.push(`Your Bakin MCP server is \`${wfServer}\`. Use mcporter for all interactions:`)
  lines.push('')
  lines.push('```bash')
  lines.push(`# Submit your output (must match the schema above)`)
  lines.push(`${wfMc('bakin_exec_submit_step', `taskId=${task.id} stepId=${stepContext.stepId} --args '<json output>'`)}`)
  lines.push('')
  lines.push(`# Log progress (mandatory, every major step)`)
  lines.push(`${wfMc('bakin_exec_tasks_log_progress', `taskId=${task.id} message="<update>"`)}`)
  lines.push('')
  lines.push(`# Check your current step details if needed`)
  lines.push(`${wfMc('bakin_exec_get_step', `taskId=${task.id}`)}`)
  lines.push('')
  lines.push('# --- Execution tools for doing actual work ---')
  lines.push('')
  // Channel posting only for output/publish steps (others have "NO SIDE EFFECTS")
  lines.push(...sharedExecutionToolDocs(agentName, task.id, { allowChannelPost: stepContext.type === 'output' }))
  lines.push('```')
  lines.push('')

  // ─── Stop Instruction ───────────────────────────────────────────────
  lines.push('## AFTER SUBMITTING')
  lines.push('')
  lines.push('After bakin_exec_submit_step returns success, your work is done. Do NOT:')
  lines.push('- Generate additional outputs or deliverables')
  lines.push('- Start work on what you think the next step might be')
  lines.push('- Send messages about what should happen next')
  lines.push('- Move the task to Done (the workflow engine handles this)')

  return lines.join('\n')
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
