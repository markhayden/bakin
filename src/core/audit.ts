/**
 * Core audit logging for Bakin.
 * Append-only JSONL file for system events.
 */
import { appendFileSync, mkdirSync, existsSync, readFileSync, openSync, readSync, closeSync, fstatSync } from 'fs'
import { join, dirname } from 'path'
import { createLogger } from './logger'

const log = createLogger('audit')

export interface AuditEvent {
  ts: string
  event: string
  agent: string
  channel?: string
  data: Record<string, unknown>
}

/**
 * Read audit events back, filtered by kind and recency. The sanctioned read
 * path over audit.jsonl — health checks and reports should use this rather
 * than hand-parsing the file. Tolerant of malformed lines.
 *
 * Time-windowed queries (sinceMs) use a reverse chunked tail read that stops
 * at the first entry older than the cutoff — a 24h health check no longer
 * pays for the entire unbounded file. Unwindowed queries keep the full read.
 */
export function queryAuditEvents(
  contentDir: string,
  opts: {
    kinds?: string[]
    sinceMs?: number
    limit?: number
    agent?: string
    /**
     * Extra predicate applied alongside kind/agent, BEFORE `limit`. Callers that
     * scope on `data` (e.g. one brand's events) must filter here rather than
     * post-slicing — otherwise a fleet-wide `limit` can drop the caller's rows
     * before they are ever seen.
     */
    match?: (event: AuditEvent) => boolean
  } = {},
): AuditEvent[] {
  const auditFile = join(contentDir, 'audit.jsonl')
  if (!existsSync(auditFile)) return []

  const kinds = opts.kinds ? new Set(opts.kinds) : null
  const cutoff = opts.sinceMs !== undefined ? Date.now() - opts.sinceMs : null

  if (cutoff !== null) {
    return queryAuditEventsTail(auditFile, cutoff, kinds, opts.limit, opts.agent, opts.match)
  }

  const results: AuditEvent[] = []
  let raw: string
  try {
    raw = readFileSync(auditFile, 'utf-8')
  } catch (err) {
    log.warn('Failed to read audit file for query', err)
    return []
  }

  for (const line of raw.split('\n')) {
    const entry = parseAuditLine(line)
    if (!entry) continue
    if (kinds && !kinds.has(entry.event)) continue
    if (opts.agent !== undefined && entry.agent !== opts.agent) continue
    if (opts.match && !opts.match(entry)) continue
    results.push(entry)
  }

  return opts.limit !== undefined ? results.slice(-opts.limit) : results
}

const TAIL_CHUNK_BYTES = 64 * 1024

function parseAuditLine(line: string): AuditEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let entry: AuditEvent
  try {
    entry = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof entry?.event !== 'string' || typeof entry?.ts !== 'string') return null
  return entry
}

/**
 * Reverse chunked read from EOF, parsing newest→oldest. The scan stops after
 * a whole chunk yields no entry inside the window — the file is append-only
 * with (near-)monotonic timestamps, so once 64KB of consecutive entries are
 * all older than the cutoff, everything earlier is too. Chunk-level (rather
 * than line-level) stopping tolerates locally out-of-order entries from
 * clock skew; disorder spanning more than a chunk is not handled (the
 * unwindowed path remains exhaustive).
 *
 * Line splitting happens at the BUFFER level on 0x0A — never a UTF-8
 * continuation byte — and the partial first line of each chunk is carried as
 * raw bytes, so multi-byte characters split across chunk boundaries decode
 * correctly. Result ordering matches the full read: file order (oldest
 * first), with `limit` keeping the last `limit` matches in file order.
 */
function queryAuditEventsTail(
  auditFile: string,
  cutoffMs: number,
  kinds: Set<string> | null,
  limit?: number,
  agent?: string,
  match?: (event: AuditEvent) => boolean,
): AuditEvent[] {
  const collected: AuditEvent[] = [] // reverse file order while scanning backwards
  let fd: number | null = null
  try {
    fd = openSync(auditFile, 'r')
    let position = fstatSync(fd).size
    let carry = Buffer.alloc(0) // partial line preceding the chunks read so far
    let stop = false

    while (position > 0 && !stop) {
      const readLen = Math.min(TAIL_CHUNK_BYTES, position)
      position -= readLen
      const buf = Buffer.alloc(readLen)
      readSync(fd, buf, 0, readLen, position)
      const chunk = Buffer.concat([buf, carry])

      let lines: Buffer[]
      if (position === 0) {
        carry = Buffer.alloc(0)
        lines = splitBufferLines(chunk)
      } else {
        const firstNewline = chunk.indexOf(0x0a)
        if (firstNewline === -1) {
          carry = chunk // no complete line yet — keep accumulating backwards
          continue
        }
        carry = chunk.subarray(0, firstNewline)
        lines = splitBufferLines(chunk.subarray(firstNewline + 1))
      }

      let sawValidEntry = false
      let sawInWindow = false
      for (let i = lines.length - 1; i >= 0; i--) {
        const entry = parseAuditLine(lines[i].toString('utf-8'))
        if (!entry) continue
        const tsMs = Date.parse(entry.ts)
        if (Number.isNaN(tsMs)) continue // matches full-read: excluded under a cutoff
        sawValidEntry = true
        if (tsMs < cutoffMs) continue
        sawInWindow = true
        if (kinds && !kinds.has(entry.event)) continue
        if (agent !== undefined && entry.agent !== agent) continue
        if (match && !match(entry)) continue
        collected.push(entry)
        if (limit !== undefined && collected.length >= limit) {
          stop = true
          break
        }
      }
      // A full chunk of valid entries with none in the window → everything
      // earlier is older still.
      if (sawValidEntry && !sawInWindow) stop = true
    }
  } catch (err) {
    log.warn('Failed to tail-read audit file for query', err)
    return []
  } finally {
    if (fd !== null) closeSync(fd)
  }
  return collected.reverse()
}

function splitBufferLines(buf: Buffer): Buffer[] {
  const lines: Buffer[] = []
  let start = 0
  let idx = buf.indexOf(0x0a, start)
  while (idx !== -1) {
    lines.push(buf.subarray(start, idx))
    start = idx + 1
    idx = buf.indexOf(0x0a, start)
  }
  if (start < buf.length) lines.push(buf.subarray(start))
  return lines
}

export function appendAudit(
  contentDir: string,
  event: string,
  agent: string,
  data: Record<string, unknown> = {},
  channel?: 'human' | 'mcp' | 'rest' | 'cli' | 'system',
): void {
  const entry = {
    ts: new Date().toISOString(),
    event,
    agent,
    ...(channel ? { channel } : {}),
    data,
  }

  const auditFile = join(contentDir, 'audit.jsonl')
  try {
    const dir = dirname(auditFile)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(auditFile, JSON.stringify(entry) + '\n')
  } catch (err) {
    log.error('Failed to write audit entry', err, { event, agent })
  }

  // Use globalThis to reach the real SSE clients. Next.js API routes get a
  // separate webpack module instance of sse.ts with an empty clients Set.
  // The custom server's sse.ts registers the real broadcast on globalThis.
  const broadcastFn = (globalThis as any).__bakinBroadcastAudit
  if (broadcastFn) {
    broadcastFn(entry)
  } else {
    log.warn('SSE broadcast not available — audit event written to disk only', { event })
  }

  // The memory plugin's indexer picks up audit.jsonl changes via the watcher
  // and indexes them into the bakin_memory table (tier=audit).
}
