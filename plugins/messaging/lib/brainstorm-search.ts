/**
 * Brainstorm session search indexer.
 *
 * Builds search documents for planning sessions stored as JSON
 * under `~/.bakin/messaging/sessions/*.json`. Per spec §5.1d, only
 * brainstorm sessions get indexed search — calendar items are out of
 * scope for this content type and get a local substring filter instead.
 *
 * Perf note (spec §6 R5 / A8): concatenating every message body plus
 * every proposal summary per session could theoretically be expensive
 * if sessions grow very large. Current dev-machine load is tens of
 * sessions at most, so the single-shot embedding is fine. If this ever
 * gets slow, the spec A8 bailout is keyword-only indexing on
 * `message_body` (drop the embedding template).
 */
import type { PlanningSession } from '../types'
import { readFileSync } from 'fs'

/** Glob pattern relative to ctx.storage. */
export const SESSION_FILE_PATTERN = 'messaging/sessions/*.json'

/**
 * Derive a search document from a loaded planning session. Concatenates
 * all message contents into `message_body` and all proposal briefs
 * (labeled with their titles) into `proposal_summaries` so the vector
 * index has something meaningful to embed even for sparse sessions.
 *
 * Returns a `Record<string, unknown>` to match the SearchAPI doc shape.
 * Field keys mirror the schema declared at the registration site.
 */
export function buildDoc(session: PlanningSession): Record<string, unknown> {
  const messageBody = session.messages
    .map(m => m.content)
    .filter(s => typeof s === 'string' && s.length > 0)
    .join('\n\n')

  const proposalSummaries = session.proposals
    .map(p => {
      const title = p.title ?? ''
      const brief = p.brief ?? ''
      if (title && brief) return `${title}: ${brief}`
      return title || brief
    })
    .filter(s => s.length > 0)
    .join('\n\n')

  const doc: Record<string, unknown> = {
    session_id: session.id,
    title: session.title ?? '',
    status: session.status ?? '',
    agent_id: session.agentId ?? '',
    message_body: messageBody,
    proposal_summaries: proposalSummaries,
  }
  // Datetime fields should be omitted when missing rather than forced
  // through adapter-specific empty-string coercion.
  if (session.createdAt) doc.created_at = session.createdAt
  if (session.updatedAt) doc.updated_at = session.updatedAt
  return doc
}

/** Derive the canonical search key for a session. */
export function sessionKey(sessionId: string): string {
  return `brainstorm-${sessionId}`
}

export function parseSessionFile(absPath: string): PlanningSession | null {
  try {
    const raw = readFileSync(absPath, 'utf-8')
    const parsed = JSON.parse(raw) as PlanningSession
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') return null
    if (!Array.isArray(parsed.messages)) parsed.messages = []
    if (!Array.isArray(parsed.proposals)) parsed.proposals = []
    return parsed
  } catch {
    return null
  }
}
