/**
 * Session tier parser.
 *
 * One OpenClaw session → one `MemoryRow` with `tier='session'`. The caller
 * (MemoryIndexer) picks the data source: gateway `sessions.list` when the
 * WS gateway is reachable, or `agents/<id>/sessions/sessions.json` as a
 * filesystem fallback. Both paths yield the same session-object shape, so
 * this parser is agnostic.
 *
 * Field mapping follows `SessionMetaSchema` in `../types.ts`. Fields that
 * aren't universally present (status, startedAt, runtimeMs, systemSent,
 * estimatedCostUsd) default to safe values — the row is still useful as a
 * row-count + token-rollup surface without them.
 */
import { createHash } from 'crypto'
import type { MemoryRow, SessionMeta } from '../types'

const SESSION_KEY_KIND_RE = /^agent:[^:]+:([^:]+)(?::.*)?$/

export function parseSession(
  agent: string,
  sessionKey: string,
  raw: unknown,
  sourcePath: string,
): MemoryRow | null {
  if (!sessionKey) return null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const s = raw as Record<string, unknown>
  const sessionId = typeof s.sessionId === 'string' ? s.sessionId : null
  if (!sessionId) return null

  const updatedAt = typeof s.updatedAt === 'number' ? s.updatedAt : Date.now()

  const meta: SessionMeta = {
    sessionKey,
    sessionId,
    kind: extractKind(sessionKey),
    chatType: pickNullableString(s.chatType) ?? pickNullableString((s.origin as Record<string, unknown> | undefined)?.chatType),
    model: pickNullableString(s.model),
    modelProvider: pickNullableString(s.modelProvider),
    inputTokens: pickNullableNumber(s.inputTokens),
    outputTokens: pickNullableNumber(s.outputTokens),
    totalTokens: pickNullableNumber(s.totalTokens),
    contextTokens: pickNullableNumber(s.contextTokens),
    estimatedCostUsd: pickNullableNumber(s.estimatedCostUsd),
    status: typeof s.status === 'string' ? s.status : 'unknown',
    startedAt: pickNullableNumber(s.startedAt),
    endedAt: typeof s.updatedAt === 'number' ? s.updatedAt : null,
    runtimeMs: pickNullableNumber(s.runtimeMs),
    abortedLastRun: s.abortedLastRun === true,
    systemSent: s.systemSent === true,
    origin: parseOrigin(s.origin),
  }

  const snippet = buildSnippet(meta)
  const sessionFile = typeof s.sessionFile === 'string' ? s.sessionFile : undefined

  return {
    id: rowId(agent, sessionKey),
    tier: 'session',
    agent,
    title: sessionKey,
    snippet,
    content: snippet,
    sourceRef: {
      backend: 'openclaw',
      path: sourcePath,
      file: sessionFile ?? sourcePath,
      sessionId,
    },
    updatedAt,
    createdAt: updatedAt,
    meta: JSON.stringify(meta),
  }
}

export function rowId(agent: string, sessionKey: string): string {
  const hash = createHash('sha256').update(`${agent}|${sessionKey}`).digest('hex').slice(0, 16)
  return `session:${hash}`
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractKind(sessionKey: string): string {
  const m = SESSION_KEY_KIND_RE.exec(sessionKey)
  return m ? m[1] : 'unknown'
}

function pickNullableString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function pickNullableNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function parseOrigin(v: unknown): SessionMeta['origin'] {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  return {
    label: pickNullableString(o.label),
    provider: pickNullableString(o.provider),
    surface: pickNullableString(o.surface),
    chatType: pickNullableString(o.chatType),
    from: pickNullableString(o.from),
    to: pickNullableString(o.to),
    accountId: pickNullableString(o.accountId),
  }
}

function buildSnippet(meta: SessionMeta): string {
  const parts = [meta.sessionKey]
  if (meta.model) parts.push(meta.model)
  if (meta.totalTokens !== null) parts.push(`tokens=${meta.totalTokens}`)
  if (meta.status !== 'unknown') parts.push(`status=${meta.status}`)
  return parts.join(' · ')
}
