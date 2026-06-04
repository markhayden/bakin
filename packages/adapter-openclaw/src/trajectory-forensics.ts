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
import { closeSync, openSync, readSync, statSync } from 'fs'
import { join } from 'path'

import type { RuntimeTurnDiagnosis } from '@bakin/core/adapters/runtime'

import { getOpenClawHome } from './home'

/** OpenClaw truncates recorded completion text at this trajectory limit. */
export const OPENCLAW_TRAJECTORY_TEXT_LIMIT = 262_144

export const DEFAULT_OVERSIZED_OUTPUT_BYTES = 128 * 1024

const SUPPORTED_TRACE_SCHEMA = 'openclaw-trajectory'
const SUPPORTED_SCHEMA_VERSION = 1

export type TrajectoryRunOutcome =
  /** The run completed successfully — `content` is the final assistant text. */
  | { kind: 'success'; content: string; sessionId?: string }
  /** The run died; `diagnosis` describes how. */
  | { kind: 'death'; diagnosis: RuntimeTurnDiagnosis }

export function trajectoryFilePathFor(agentId: string, cliSessionId: string): string {
  return join(getOpenClawHome(), 'agents', agentId, 'sessions', `${cliSessionId}.trajectory.jsonl`)
}

export function safeTrajectoryOffset(trajectoryFile: string): number {
  try {
    return statSync(trajectoryFile).size
  } catch {
    return 0
  }
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

function readFrom(trajectoryFile: string, offset: number): string | null {
  let fd: number | null = null
  try {
    const size = statSync(trajectoryFile).size
    if (size <= offset) return size === offset ? '' : null
    fd = openSync(trajectoryFile, 'r')
    const buffer = Buffer.alloc(size - offset)
    readSync(fd, buffer, 0, buffer.length, offset)
    return buffer.toString('utf-8')
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
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
  const raw = readFrom(opts.trajectoryFile, Math.max(0, opts.sinceByteOffset ?? 0))
  if (raw === null) return null

  const state: ScanState = {}
  let sawSupportedSchema = false

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let record: unknown
    try {
      record = JSON.parse(trimmed)
    } catch {
      continue // partial/corrupt line — skip, keep scanning
    }
    if (!isRecord(record) || typeof record.type !== 'string') continue
    if (record.traceSchema !== SUPPORTED_TRACE_SCHEMA) continue
    if (record.schemaVersion !== SUPPORTED_SCHEMA_VERSION) continue
    sawSupportedSchema = true

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
  }

  if (!sawSupportedSchema || !state.ended) return null

  const content = (state.completed?.texts ?? []).join('\n')

  if (state.ended.status === 'success') {
    return {
      kind: 'success',
      content,
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    }
  }

  const completionBytes = Buffer.byteLength(content, 'utf-8')
  const outputTruncated = completionBytes >= OPENCLAW_TRAJECTORY_TEXT_LIMIT
  const threshold = opts.oversizedOutputBytes ?? DEFAULT_OVERSIZED_OUTPUT_BYTES
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
