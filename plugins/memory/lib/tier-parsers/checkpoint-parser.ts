/**
 * Checkpoint tier parser.
 *
 * A checkpoint file is a `.checkpoint.<checkpointId>.jsonl` sibling of a
 * session transcript. It replays the session header + messages up to the
 * compaction point and then records one `type=compaction` event whose
 * `summary` is the human-readable payload. First compaction wins — if a
 * file contains multiple (rare), subsequent ones are ignored.
 *
 * Runtime checkpoint files carry `tokensBefore` and `fromHook`, but never
 * `tokensAfter`, so the parser surfaces `tokensAfter` as null. `trigger`
 * derives from `fromHook`:
 *   true  → 'auto'     (compaction was hook-triggered)
 *   false → 'manual'   (compaction was explicitly invoked)
 *   absent → 'unknown' (older files or malformed events)
 */
import { createHash } from 'crypto'
import type { MemoryRow } from '../types'

const SNIPPET_CAP = 2048
const CHECKPOINT_FILENAME_RE = /^([^.]+)\.checkpoint\.([^.]+)\.jsonl$/

export function matchCheckpointFilename(
  filename: string,
): { sessionId: string; checkpointId: string } | null {
  const m = CHECKPOINT_FILENAME_RE.exec(filename)
  if (!m) return null
  return { sessionId: m[1], checkpointId: m[2] }
}

interface CompactionEvent {
  summary: string
  tokensBefore: number | null
  fromHook: boolean | undefined
  timestamp: string | null
}

function extractCompaction(body: string): CompactionEvent | null {
  const lines = body.split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    let obj: unknown
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (!obj || typeof obj !== 'object') continue
    const rec = obj as Record<string, unknown>
    if (rec.type !== 'compaction') continue
    const summary = typeof rec.summary === 'string' ? rec.summary : ''
    const tokensBefore =
      typeof rec.tokensBefore === 'number' ? rec.tokensBefore : null
    const fromHook =
      typeof rec.fromHook === 'boolean' ? rec.fromHook : undefined
    const timestamp =
      typeof rec.timestamp === 'string' ? rec.timestamp : null
    return { summary, tokensBefore, fromHook, timestamp }
  }
  return null
}

function triggerFromHook(fromHook: boolean | undefined): string {
  if (fromHook === true) return 'auto'
  if (fromHook === false) return 'manual'
  return 'unknown'
}

export function parseCheckpoint(
  agent: string,
  sessionId: string,
  checkpointId: string,
  filename: string,
  body: string,
  sourcePath: string,
  mtimeMs: number,
): MemoryRow | null {
  if (!body) return null
  const cmp = extractCompaction(body)
  if (!cmp) return null

  const createdAt = cmp.timestamp ? Date.parse(cmp.timestamp) : mtimeMs
  const resolvedCreatedAt = Number.isFinite(createdAt) ? createdAt : mtimeMs

  const content = cmp.summary
  const snippet = content.length > SNIPPET_CAP ? content.slice(0, SNIPPET_CAP) : content
  const trigger = triggerFromHook(cmp.fromHook)
  const title = `Checkpoint ${sessionId.slice(0, 8)} → ${checkpointId.slice(0, 8)}`

  return {
    id: rowId(agent, sessionId, checkpointId),
    tier: 'checkpoint',
    agent,
    title,
    snippet,
    content,
    sourceRef: {
      backend: 'runtime',
      path: sourcePath,
      file: filename,
      sessionId,
      checkpointId,
    },
    updatedAt: mtimeMs,
    createdAt: resolvedCreatedAt,
    meta: JSON.stringify({
      sessionId,
      checkpointId,
      trigger,
      tokensBefore: cmp.tokensBefore,
      tokensAfter: null,
      summary: content,
      createdAt: resolvedCreatedAt,
    }),
  }
}

export function rowId(agent: string, sessionId: string, checkpointId: string): string {
  const hash = createHash('sha256')
    .update(`${agent}|${sessionId}|${checkpointId}`)
    .digest('hex')
    .slice(0, 16)
  return `checkpoint:${hash}`
}
