/**
 * Client-side self-update verification (#1007 D7.11): after the restart
 * handoff, poll `GET /api/version` until a NEW boot serves the expected
 * version. Explicit and shared by the browser hook and the CLI twin — a
 * disconnect is never required (an uninterrupted connection to the old
 * process simply keeps answering the old boot id until the successor takes
 * over), and a draining successor (`starting`) is waited out.
 */

export interface VersionAnswer {
  version: string
  bootId: string
  state: 'starting' | 'serving' | 'stopping'
}

export type SelfUpdateVerification =
  | { status: 'verified'; version: string; bootId: string }
  | { status: 'wrong-version'; version: string; bootId: string; expectedVersion: string }
  | { status: 'unreachable'; expectedVersion: string; lastError?: string }

export interface VerifySelfUpdateOptions {
  expectedVersion: string
  oldBootId: string
  fetch: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>
  /** Prefix for `/api/version`; '' for same-origin browser calls. */
  baseUrl?: string
  /** Default 90 s. */
  timeoutMs?: number
  pollMs?: number
  signal?: AbortSignal
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export const SELF_UPDATE_VERIFY_TIMEOUT_MS = 90_000

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, '')
}

export async function verifySelfUpdate(options: VerifySelfUpdateOptions): Promise<SelfUpdateVerification> {
  const timeoutMs = options.timeoutMs ?? SELF_UPDATE_VERIFY_TIMEOUT_MS
  const pollMs = options.pollMs ?? 500
  const now = options.now ?? (() => Date.now())
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const expected = normalizeVersion(options.expectedVersion)
  const deadline = now() + timeoutMs
  let lastError: string | undefined
  for (;;) {
    if (options.signal?.aborted) return { status: 'unreachable', expectedVersion: options.expectedVersion, lastError: 'cancelled' }
    // Every request (and its body read) is bounded by what is left of the
    // deadline, composed with the caller's cancellation: a hung connection
    // or a body that never ends can only cost the remaining budget.
    const request = new AbortController()
    const onCancel = (): void => request.abort(options.signal?.reason ?? new Error('cancelled'))
    options.signal?.addEventListener('abort', onCancel, { once: true })
    const budget = setTimeout(() => request.abort(new Error('verification deadline')), Math.max(0, deadline - now()))
    try {
      const res = await options.fetch(`${options.baseUrl ?? ''}/api/version`, { signal: request.signal })
      if (res.ok) {
        const answer = (await res.json()) as Partial<VersionAnswer>
        if (typeof answer.bootId === 'string' && typeof answer.version === 'string') {
          // The old process answering is not evidence either way — keep polling.
          if (answer.bootId !== options.oldBootId && answer.state === 'serving') {
            return normalizeVersion(answer.version) === expected
              ? { status: 'verified', version: answer.version, bootId: answer.bootId }
              : { status: 'wrong-version', version: answer.version, bootId: answer.bootId, expectedVersion: options.expectedVersion }
          }
        }
      } else {
        lastError = `HTTP ${res.status}`
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    } finally {
      clearTimeout(budget)
      options.signal?.removeEventListener('abort', onCancel)
    }
    if (options.signal?.aborted) return { status: 'unreachable', expectedVersion: options.expectedVersion, lastError: 'cancelled' }
    if (now() >= deadline) return { status: 'unreachable', expectedVersion: options.expectedVersion, ...(lastError ? { lastError } : {}) }
    await sleep(pollMs)
  }
}

/** One line for people, shared by the CLI and the toast copy. */
export function describeSelfUpdateVerification(verification: SelfUpdateVerification): string {
  switch (verification.status) {
    case 'verified': return `verified ${verification.version}`
    case 'wrong-version': return `wrong version ${verification.version} (expected ${verification.expectedVersion})`
    case 'unreachable': return `unreachable — verify by hand${verification.lastError ? ` (${verification.lastError})` : ''}`
  }
}
