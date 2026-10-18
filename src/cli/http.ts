/**
 * Shared HTTP client for the Bakin CLI. One BASE_URL resolution (BAKIN_URL-aware)
 * + the api/apiGet/apiPost/apiPostJson/apiDelete helpers and the small JSON/error
 * shape guards, extracted from cli/bakin.ts so every CLI surface — including
 * src/cli/schedule.ts — shares one host resolution. Honoring BAKIN_URL here fixes
 * the prior schedule-CLI bug where it silently hit localhost regardless of BAKIN_URL.
 *
 * Only `fetch` + the lightweight api-error helpers are imported; nothing here pulls
 * server-core or heavy deps into the binary entry's import graph.
 */
import { isOperationFinished, type OperationCancelResult, type OperationView } from '@makinbakin/sdk/types'
import { extractApiErrorMessage, formatApiError } from '../core/cli/api-error'
import { getContentDir } from '../core/content-dir'
import { liveServerBaseUrl, readLiveServerLock, resolveCliTarget, type CliTarget } from '../core/server-lock'
import { identityHeaders, resolveCliIdentity, type CliIdentity } from './identity'

/**
 * Which server this CLI talks to (#895 D11), resolved once at import with the
 * ONE rule (`resolveCliTarget`, src/core/server-lock.ts); server-only verbs
 * fail with `BakinNotRunningError` when no server runs for this home.
 */
export const CLI_TARGET = resolveCliTarget(process.env, readLiveServerLock())

/** For display and probes (`bakin status`, help). Requests go through `serverBaseUrl()`. */
export const BASE_URL = CLI_TARGET.baseUrl

/** No server is running for this CLI's home (and no BAKIN_URL was given). */
export class BakinNotRunningError extends Error {
  constructor() {
    super(`Bakin isn't running for ${getContentDir()}. Start it with \`bakin start\` (or set BAKIN_URL to reach another server).`)
    this.name = 'BakinNotRunningError'
  }
}

/** The base URL for a server request; throws when no server runs for this home. */
export function serverBaseUrl(target: CliTarget = CLI_TARGET): string {
  if (target.source === 'none') throw new BakinNotRunningError()
  return target.baseUrl
}

/** How the target was chosen, for error details. */
export function describeCliTarget(target: CliTarget = CLI_TARGET): string {
  if (target.source === 'env') return `${target.baseUrl} (BAKIN_URL)`
  if (target.source === 'lock') return `${target.baseUrl} (server.lock, pid ${target.pid})`
  return `no server.lock with a live process in ${getContentDir()}`
}

/** Operations started by the CLI are attributed to it (#895 D14 attention routing). */
export const CLI_ORIGIN_HEADER = { 'X-Bakin-Origin': 'cli' } as const

let identity: Promise<CliIdentity> | null = null

/**
 * This invocation's identity (#898), resolved once: env marker, run-dir
 * sidecar, and — only for `--as human` — the server's workspace check.
 */
export function cliIdentity(): Promise<CliIdentity> {
  identity ??= resolveCliIdentity({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    env: process.env,
    // The workspace authority is THIS home's server (server.lock), never a
    // BAKIN_URL target: another machine cannot vouch for this cwd.
    probeWorkspace: async (cwd) => {
      const local = liveServerBaseUrl({})
      if (!local) {
        // No server for this home (e.g. BAKIN_URL reaches another machine):
        // check this cwd in-process against this home's runtime, read-only —
        // the same strict lookup the server runs. It throws when it cannot tell.
        const { createAppServices, maybeGetAppServices } = await import('../core/app-services')
        if (!maybeGetAppServices()) await createAppServices()
        const { agentContextForPath } = await import('../core/approvals/agent-context')
        return agentContextForPath(cwd)
      }
      const res = await fetch(`${local}/api/approvals/agent-context?cwd=${encodeURIComponent(cwd)}`, { headers: { ...CLI_ORIGIN_HEADER } })
      if (!res.ok) throw new Error(`the workspace check failed (HTTP ${res.status})`)
      const body = await res.json() as { agentId?: unknown }
      if (body.agentId !== null && typeof body.agentId !== 'string') throw new Error('the workspace check answered in an unexpected shape')
      return body.agentId
    },
  }).then((resolved) => {
    if (resolved.declarationWithheld) console.error(`--as human is not honored: ${resolved.declarationWithheld}.`)
    return resolved
  })
  return identity
}

/** Test seam: forget the resolved identity. */
export function resetCliIdentityForTests(): void {
  identity = null
}

/** `fetch` against this home's server — for callers that need the raw Response. */
export async function cliFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = identityHeaders(await cliIdentity())
  return fetch(`${serverBaseUrl()}${path}`, { ...init, headers: { ...CLI_ORIGIN_HEADER, ...headers, ...init?.headers } })
}

export interface CliRoster {
  agentIds: string[]
  mainAgentId?: string | null
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
export async function api(path: string, options?: RequestInit): Promise<unknown> {
  const identityHeaderSet = identityHeaders(await cliIdentity())
  const res = await fetch(`${serverBaseUrl()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...CLI_ORIGIN_HEADER,
      ...identityHeaderSet,
      ...options?.headers,
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(formatApiError(res.status, body))
  }
  return res.json()
}

export async function apiGet(path: string): Promise<unknown> {
  return api(path)
}

export async function apiPost(path: string, body?: unknown): Promise<unknown> {
  return api(path, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  })
}

export async function apiDelete(path: string, body?: unknown): Promise<unknown> {
  return api(path, {
    method: 'DELETE',
    body: body ? JSON.stringify(body) : undefined,
  })
}

export function jsonObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function parseJsonText(text: string): unknown {
  if (!text.trim()) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function apiErrorPayload(status: number, body: string): Record<string, unknown> {
  const parsed = jsonObject(parseJsonText(body))
  const message = extractApiErrorMessage(body) || `HTTP ${status}`
  return {
    ...(parsed ?? {}),
    ok: false,
    status,
    error: typeof parsed?.error === 'string' && parsed.error.trim() ? parsed.error : message,
  }
}

export function isServerConnectionError(err: unknown): boolean {
  if (err instanceof BakinNotRunningError) return true
  // Raw fetch() failures carry no typed taxonomy (this is the CLI probing a
  // possibly-down local server, upstream of any adapter) — message sniffing
  // is the only signal available here.
  const message = err instanceof Error ? err.message : String(err) // arch:allow-error-message untyped fetch errors
  return message.includes('ECONNREFUSED') || // arch:allow-error-message untyped fetch errors
    message.includes('Unable to connect') || // arch:allow-error-message untyped fetch errors
    message.includes('fetch failed') // arch:allow-error-message untyped fetch errors
}

export async function apiPostJson(
  path: string,
  body?: unknown,
): Promise<{ ok: true; data: unknown } | { ok: false; data: Record<string, unknown> }> {
  const res = await fetch(`${serverBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...CLI_ORIGIN_HEADER },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) {
    return { ok: false, data: apiErrorPayload(res.status, text) }
  }
  return { ok: true, data: parseJsonText(text) }
}

export async function getCliRoster(): Promise<CliRoster> {
  const result = await apiGet('/api/plugins/team/') as {
    agents?: Array<{ id?: unknown }>
    mainAgentId?: string | null
  }
  return {
    agentIds: (result.agents ?? [])
      .map((agent) => agent.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
    mainAgentId: result.mainAgentId,
  }
}

// ---------------------------------------------------------------------------
// Operations (#895): follow one operation over SSE with snapshot reconcile
// ---------------------------------------------------------------------------

export interface OperationFollowUpdate {
  operation: OperationView
  /** Child operations in the parent's declared order. */
  children: OperationView[]
}

export interface OperationFollowResult {
  /**
   * `finished` — terminal view received. `expired` — the same server no longer
   * has the record. `restarted` — the server's boot changed (outcome
   * unknown). `detached` — the caller stopped following (Ctrl-C).
   */
  phase: 'finished' | 'expired' | 'restarted' | 'detached'
  operation: OperationView | null
  children: OperationView[]
}

export interface FollowOperationOptions {
  onUpdate?: (update: OperationFollowUpdate) => void
  /** Stop following (the operation keeps running on the server). */
  signal?: AbortSignal
  /** Snapshot cadence while the stream is quiet; ticks are not replayable. */
  reconcileMs?: number
  /** Reconnect backoff after the stream drops. */
  reconnectMs?: { initial: number; max: number }
  baseUrl?: string
}

/**
 * Follows `operationId` until it settles: the shell's SSE stream for live
 * `operation.updated` events (resuming with Last-Event-ID), plus a snapshot
 * read on every (re)connect and on a timer. Highest rev wins within the
 * start's boot; a different boot is `restarted`, a same-boot 404 `expired`.
 */
export async function followOperation(
  start: { operationId: string; bootId: string },
  opts: FollowOperationOptions = {},
): Promise<OperationFollowResult> {
  const base = opts.baseUrl ?? serverBaseUrl()
  const reconcileMs = opts.reconcileMs ?? 5_000
  const backoff = opts.reconnectMs ?? { initial: 500, max: 5_000 }
  let operation: OperationView | null = null
  const children = new Map<string, OperationView>()
  let settle!: (result: OperationFollowResult) => void
  const settled = new Promise<OperationFollowResult>((resolve) => { settle = resolve })
  let done = false
  const controller = new AbortController()

  const orderedChildren = () => (operation?.children ?? []).map((id) => children.get(id)).filter((c): c is OperationView => Boolean(c))
  const end = (phase: OperationFollowResult['phase']) => {
    if (done) return
    done = true
    controller.abort()
    settle({ phase, operation, children: orderedChildren() })
  }
  const apply = (view: OperationView) => {
    if (done || view.bootId !== start.bootId) return
    if (view.id === start.operationId) {
      if (operation && operation.rev >= view.rev) return
      operation = view
    } else if (view.parentId === start.operationId) {
      const held = children.get(view.id)
      if (held && held.rev >= view.rev) return
      children.set(view.id, view)
    } else return
    if (operation) opts.onUpdate?.({ operation, children: orderedChildren() })
    if (operation && isOperationFinished(operation.status)) end('finished')
  }

  const reconcile = async () => {
    try {
      const res = await fetch(`${base}/api/operations/${encodeURIComponent(start.operationId)}?children=1`, { signal: controller.signal })
      const body = jsonObject(await res.json().catch(() => null))
      if (done || !body) return
      if (typeof body.bootId === 'string' && body.bootId !== start.bootId) return end('restarted')
      if (res.status === 404) return end(operation && isOperationFinished(operation.status) ? 'finished' : 'expired')
      for (const child of (Array.isArray(body.children) ? body.children : []) as OperationView[]) apply(child)
      if (body.operation) apply(body.operation as OperationView)
    } catch {
      // Transport failure: the stream loop reconnects and reconciles again.
    }
  }

  const stream = async () => {
    let lastEventId: string | undefined
    let delay = backoff.initial
    while (!done) {
      try {
        const res = await fetch(`${base}/api/events`, {
          signal: controller.signal,
          headers: { Accept: 'text/event-stream', ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}) },
        })
        if (!res.ok || !res.body) throw new Error(`events stream answered ${res.status}`)
        delay = backoff.initial
        void reconcile()
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
        let buffer = ''
        for (;;) {
          const { value, done: streamDone } = await reader.read()
          if (streamDone) break
          buffer += value
          let boundary: number
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            let data = ''
            for (const line of frame.split('\n')) {
              if (line.startsWith('id:')) lastEventId = line.slice(3).trim()
              else if (line.startsWith('data:')) data += line.slice(5).trim()
            }
            const payload = jsonObject(parseJsonText(data))
            if (payload?.type === 'plugin-event' && payload.event === 'operation.updated' && payload.view) apply(payload.view as OperationView)
          }
        }
      } catch {
        if (done) return
      }
      if (done) return
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay = Math.min(delay * 2, backoff.max)
    }
  }

  opts.signal?.addEventListener('abort', () => end('detached'), { once: true })
  if (opts.signal?.aborted) end('detached')
  const timer = setInterval(() => { void reconcile() }, reconcileMs)
  // The first snapshot never waits on the stream: a server whose events
  // endpoint is down still shows the current state at once.
  void reconcile()
  void stream()
  try {
    return await settled
  } finally {
    clearInterval(timer)
  }
}

/** Cancel through the server; returns the registry's answer (or `unreachable`). */
export async function cancelOperationRemote(operationId: string, baseUrl?: string): Promise<OperationCancelResult | 'unreachable'> {
  try {
    const res = await fetch(`${baseUrl ?? serverBaseUrl()}/api/operations/${encodeURIComponent(operationId)}/cancel`, { method: 'POST', headers: CLI_ORIGIN_HEADER })
    const body = jsonObject(await res.json().catch(() => null))
    return typeof body?.status === 'string' ? body.status as OperationCancelResult : 'unreachable'
  } catch {
    return 'unreachable'
  }
}
