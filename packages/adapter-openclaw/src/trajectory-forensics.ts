/**
 * Post-mortem forensics over OpenClaw session trajectory files.
 *
 * OpenClaw writes an `openclaw-trajectory` (schemaVersion 1) JSONL sibling
 * next to each session file: `<sessionId>.trajectory.jsonl`. Each run within
 * a session emits `session.started` → `context.compiled` → `prompt.submitted`
 * → `tool.call`/`tool.result`* → `model.completed` → `session.ended`.
 *
 * When a turn dies (oversized completion, interruption, server-side timeout)
 * the gateway never delivers a final frame — but the evidence is on disk.
 * This module reads the trajectory tail (from the byte offset captured at
 * turn start) and classifies what actually happened, entirely inside the
 * adapter boundary. Read-only: Bakin never writes to ~/.openclaw.
 */
import { join } from 'path'

import { RuntimeTurnError, type RuntimeTurnDiagnosis } from '@bakin/core/adapters/runtime'

import { readFileBytesFrom, safeFileSize } from './file-utils'
import { getOpenClawHome } from './home'

/** OpenClaw truncates recorded completion text at this trajectory limit. */
export const OPENCLAW_TRAJECTORY_TEXT_LIMIT = 262_144

/**
 * Death-watch trajectory poll interval (stat-gated; see
 * `watchTrajectoryForDeath`). Formerly OPENCLAW_SESSION_ACTIVITY_POLL_MS,
 * when the deleted live activity tail shared it.
 */
export const OPENCLAW_TRAJECTORY_POLL_MS = 200

export const DEFAULT_OVERSIZED_OUTPUT_BYTES = 128 * 1024

const SUPPORTED_TRACE_SCHEMA = 'openclaw-trajectory'
const SUPPORTED_SCHEMA_VERSION = 1

/** Token usage for one model turn, as recorded in `model.completed`. */
export interface TrajectoryUsage {
  input?: number
  output?: number
  total?: number
}

export type TrajectoryRunOutcome =
  /** The run completed successfully — `content` is the final assistant text. */
  | { kind: 'success'; content: string; sessionId?: string; usage?: TrajectoryUsage }
  /** The run died; `diagnosis` describes how. */
  | { kind: 'death'; diagnosis: RuntimeTurnDiagnosis }

export function trajectoryFilePathFor(agentId: string, cliSessionId: string): string {
  return join(getOpenClawHome(), 'agents', agentId, 'sessions', `${cliSessionId}.trajectory.jsonl`)
}

interface ScanState {
  sessionId?: string
  lastToolCall?: string
  completed?: {
    texts: string[]
    timedOut: boolean
    aborted: boolean
    usage?: { input?: number; output?: number; total?: number }
  }
  ended?: {
    status: string
    timedOut: boolean
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Apply one trajectory line to the scan state. Returns true when the line is a supported-schema event. */
function applyTrajectoryLine(state: ScanState, trimmed: string): boolean {
  let record: unknown
  try {
    record = JSON.parse(trimmed)
  } catch {
    return false // partial/corrupt line — skip, keep scanning
  }
  if (!isRecord(record) || typeof record.type !== 'string') return false
  if (record.traceSchema !== SUPPORTED_TRACE_SCHEMA) return false
  if (record.schemaVersion !== SUPPORTED_SCHEMA_VERSION) return false

  const data = isRecord(record.data) ? record.data : {}
  if (typeof record.sessionId === 'string') state.sessionId = record.sessionId

  switch (record.type) {
    case 'session.started':
      // A new run after the offset resets per-run evidence.
      state.lastToolCall = undefined
      state.completed = undefined
      state.ended = undefined
      break
    case 'tool.call':
      if (typeof data.name === 'string') state.lastToolCall = data.name
      break
    case 'model.completed': {
      const texts = Array.isArray(data.assistantTexts)
        ? data.assistantTexts.filter((t): t is string => typeof t === 'string')
        : []
      const usage = isRecord(data.usage)
        ? {
            ...(typeof data.usage.input === 'number' ? { input: data.usage.input } : {}),
            ...(typeof data.usage.output === 'number' ? { output: data.usage.output } : {}),
            ...(typeof data.usage.total === 'number' ? { total: data.usage.total } : {}),
          }
        : undefined
      state.completed = {
        texts,
        timedOut: data.timedOut === true,
        aborted: data.aborted === true,
        ...(usage ? { usage } : {}),
      }
      break
    }
    case 'session.ended':
      state.ended = {
        status: typeof data.status === 'string' ? data.status : 'unknown',
        timedOut: data.timedOut === true,
      }
      break
    default:
      break
  }
  return true
}

/** Compute the run outcome from the accumulated scan state (the original inspect tail logic). */
function outcomeFromState(state: ScanState, sawSupportedSchema: boolean, oversizedOutputBytes?: number): TrajectoryRunOutcome | null {
  if (!sawSupportedSchema || !state.ended) return null

  const content = (state.completed?.texts ?? []).join('\n')

  if (state.ended.status === 'success') {
    return {
      kind: 'success',
      content,
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
      ...(state.completed?.usage ? { usage: state.completed.usage } : {}),
    }
  }

  const completionBytes = Buffer.byteLength(content, 'utf-8')
  const outputTruncated = completionBytes >= OPENCLAW_TRAJECTORY_TEXT_LIMIT
  const threshold = oversizedOutputBytes ?? DEFAULT_OVERSIZED_OUTPUT_BYTES
  const oversizedOutput = completionBytes > threshold
  const timedOut = state.ended.timedOut || state.completed?.timedOut === true
  const reason = timedOut ? 'runtime_timeout' : 'session_interrupted'

  const sizeLabel = `${Math.round(completionBytes / 1024)}KB${outputTruncated ? ', truncated' : ''}`
  const detail = reason === 'runtime_timeout'
    ? `OpenClaw session timed out before reporting completion (status: ${state.ended.status})`
    : oversizedOutput
      ? `OpenClaw session ${state.ended.status} after oversized model completion (${sizeLabel}); agent never reported completion`
      : `OpenClaw session ${state.ended.status} before reporting completion (completion: ${sizeLabel})`

  const diagnosis: RuntimeTurnDiagnosis = {
    reason,
    ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    sessionStatus: state.ended.status,
    timedOut,
    completionBytes,
    outputTruncated,
    oversizedOutput,
    ...(state.lastToolCall ? { lastToolCall: state.lastToolCall } : {}),
    ...(content ? { salvagedText: content.slice(0, OPENCLAW_TRAJECTORY_TEXT_LIMIT) } : {}),
    ...(state.completed?.usage ? { usage: state.completed.usage } : {}),
    detail,
  }

  return { kind: 'death', diagnosis }
}

/**
 * Incremental trajectory scanner. feed() consumes raw appended bytes —
 * complete lines are parsed exactly once and folded into the carried scan
 * state; a trailing partial line is buffered AS BYTES (a multi-byte char
 * split across reads must not be decoded early). finalize() evaluates the
 * outcome as-if-EOF: the buffered partial is probed against a CLONE of the
 * state so future bytes can still complete it.
 */
interface TrajectoryScanner {
  feed(chunk: Buffer): void
  finalize(oversizedOutputBytes?: number): TrajectoryRunOutcome | null
}

function createTrajectoryScanner(): TrajectoryScanner {
  const state: ScanState = {}
  let sawSupportedSchema = false
  let carry = Buffer.alloc(0)

  return {
    feed(chunk: Buffer): void {
      const buf = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk
      let start = 0
      let idx = buf.indexOf(0x0a, start)
      while (idx !== -1) {
        const trimmed = buf.subarray(start, idx).toString('utf-8').trim()
        if (trimmed) sawSupportedSchema = applyTrajectoryLine(state, trimmed) || sawSupportedSchema
        start = idx + 1
        idx = buf.indexOf(0x0a, start)
      }
      carry = Buffer.from(buf.subarray(start)) // copy — chunk's memory may be reused
    },
    finalize(oversizedOutputBytes?: number): TrajectoryRunOutcome | null {
      const trimmed = carry.length > 0 ? carry.toString('utf-8').trim() : ''
      if (!trimmed) return outcomeFromState(state, sawSupportedSchema, oversizedOutputBytes)
      // Probe the unterminated final line against a clone — applyTrajectoryLine
      // only ever REPLACES state fields, so a shallow clone is a safe snapshot.
      const probe: ScanState = { ...state }
      const probeSaw = applyTrajectoryLine(probe, trimmed) || sawSupportedSchema
      return outcomeFromState(probe, probeSaw, oversizedOutputBytes)
    },
  }
}

/**
 * Scan trajectory events appended after `sinceByteOffset` and report the
 * outcome of the most recent run. Returns null when there is no usable
 * evidence (missing/unreadable file, unknown schema, or no `session.ended`
 * yet — the run may still be in flight).
 *
 * Tolerant by design: malformed lines and unknown event types are skipped.
 * A broken trajectory must never make a failure LESS diagnosable.
 */
export function inspectTrajectoryRun(opts: {
  trajectoryFile: string
  sinceByteOffset?: number
  oversizedOutputBytes?: number
}): TrajectoryRunOutcome | null {
  const read = readFileBytesFrom(opts.trajectoryFile, Math.max(0, opts.sinceByteOffset ?? 0))
  if (read === null) return null
  const scanner = createTrajectoryScanner()
  scanner.feed(read.bytes)
  return scanner.finalize(opts.oversizedOutputBytes)
}

/**
 * Sentinel rejection for the fail-fast race: the run SUCCEEDED on disk but
 * the gateway never delivered the final frame within the grace window. The
 * caller treats this as a successful turn with the recovered content —
 * without it, a lost-final-frame success would hold a concurrency slot for
 * the full transport timeout before post-mortem recovery.
 */
export class TrajectoryRecoveredTurn extends Error {
  readonly content: string
  readonly sessionId?: string
  readonly usage?: TrajectoryUsage

  constructor(content: string, sessionId?: string, usage?: TrajectoryUsage) {
    super('Turn succeeded on disk; gateway frame not delivered within grace window')
    this.name = 'TrajectoryRecoveredTurn'
    this.content = content
    this.sessionId = sessionId
    this.usage = usage
  }
}

export interface TrajectoryDeathWatch {
  /**
   * Rejects with RuntimeTurnError the moment the run's session.ended
   * (non-success) lands on disk, or with TrajectoryRecoveredTurn when the
   * run succeeded on disk but the gateway frame didn't arrive within the
   * grace window. Never resolves.
   */
  promise: Promise<never>
  stop: () => void
}

const DEFAULT_SUCCESS_GRACE_MS = 2_000

/**
 * Fail-fast watcher raced against a pending gateway agent request. Polls the
 * trajectory file (stat first — only re-inspects when the size changes):
 * - death on disk → reject immediately with the diagnosed RuntimeTurnError;
 * - success on disk → give the gateway frame a grace window to win the race
 *   (its payload is authoritative), then reject with TrajectoryRecoveredTurn
 *   carrying the recovered content so a lost frame doesn't cost the full
 *   transport timeout.
 */
export function watchTrajectoryForDeath(opts: {
  trajectoryFile: string
  sinceByteOffset: number
  oversizedOutputBytes?: number
  pollMs: number
  successGraceMs?: number
}): TrajectoryDeathWatch {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastSize = -1
  // Incremental scan: new bytes are fed into a carried scanner instead of
  // re-reading + re-parsing the whole tail from the turn-start offset on
  // every size change (which was O(delta²) over tool-heavy turns).
  let cursor = Math.max(0, opts.sinceByteOffset)
  const scanner = createTrajectoryScanner()

  const stop = (): void => {
    stopped = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const promise = new Promise<never>((_, reject) => {
    const tick = (): void => {
      if (stopped) return
      const size = safeFileSize(opts.trajectoryFile)
      if (size !== lastSize) {
        lastSize = size
        // null read (shrunk/rotated/unreadable) → skip this tick without
        // corrupting the carried state; the next tick retries. Assumption:
        // a trajectory is append-only for the turn's lifetime (one run per
        // turn) — a mid-turn rotation that regrows past the stuck cursor
        // would be scanned from the cursor, not from 0, same as the old
        // full-rescan-from-turn-start behavior.
        const read = readFileBytesFrom(opts.trajectoryFile, cursor)
        let outcome: TrajectoryRunOutcome | null = null
        if (read) {
          cursor = read.nextOffset
          scanner.feed(read.bytes)
          outcome = scanner.finalize(opts.oversizedOutputBytes)
        }
        if (outcome?.kind === 'death') {
          stop()
          reject(new RuntimeTurnError(outcome.diagnosis))
          return
        }
        if (outcome?.kind === 'success') {
          // Stop polling; arm the grace timer. If the gateway frame settles
          // the race first, stop() clears this timer.
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            if (stopped) return
            stop()
            reject(new TrajectoryRecoveredTurn(outcome.content, outcome.sessionId, outcome.usage))
          }, opts.successGraceMs ?? DEFAULT_SUCCESS_GRACE_MS)
          timer.unref?.()
          return
        }
      }
      timer = setTimeout(tick, opts.pollMs)
      timer.unref?.()
    }
    tick()
  })
  // The race winner may be the gateway response — pre-attach a no-op catch
  // so a late death rejection can never surface as an unhandled rejection.
  promise.catch(() => {})

  return { promise, stop }
}
