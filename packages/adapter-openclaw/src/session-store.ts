/**
 * OpenClaw session identity — the deterministic agent/sessionKey → CLI
 * session-id mapping.
 *
 * The sessions.json resolve/cache half that used to live here died with the
 * trajectory activity tail (its only consumer); resurrect from git history
 * if T28 (real sessions.list/get) wants it. Chat streaming and dispatch
 * liveness ride gateway push events (`stream-events.ts`); trajectory files
 * are read only by `trajectory-forensics.ts`.
 */
import { createHash } from 'crypto'

export function openClawCliSessionId(agentId: string, sessionKey: string): string {
  if (isOpenClawCliSessionId(sessionKey)) return sessionKey
  return deterministicUuid(`bakin:${agentId}:${sessionKey}`)
}

/**
 * The gateway's canonical key for an explicit-sessionId session. Threaded
 * sends MUST pass this alongside `sessionId`: a run addressed by sessionId
 * alone is never registered in the gateway's chat-abort registry (ack
 * omits sessionKey; chat.abort AND sessions.abort miss — fixture
 * abort-explicit-session.jsonl), so server-side abort silently fails.
 * Sending both registers the run AND keeps the underlying sessionId (and
 * trajectory filename) ours (fixture abort-sessionkey-addressed.jsonl).
 */
export function openClawExplicitSessionKey(agentId: string, cliSessionId: string): string {
  return `agent:${agentId}:explicit:${cliSessionId}`
}

export function isOpenClawCliSessionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function deterministicUuid(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  const variant = Number.parseInt(hex[16] ?? '0', 16)
  hex[16] = ((variant & 0x3) | 0x8).toString(16)
  const id = hex.join('')
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`
}
