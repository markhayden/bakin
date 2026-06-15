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
import { extractApiErrorMessage, formatApiError } from '../core/cli/api-error'

export const BASE_URL = process.env.BAKIN_URL || `http://localhost:${process.env.PORT || 3737}`

export interface CliRoster {
  agentIds: string[]
  mainAgentId?: string | null
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
export async function api(path: string, options?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
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
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('ECONNREFUSED') ||
    message.includes('Unable to connect') ||
    message.includes('fetch failed')
}

export async function apiPostJson(
  path: string,
  body?: unknown,
): Promise<{ ok: true; data: unknown } | { ok: false; data: Record<string, unknown> }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) {
    return { ok: false, data: apiErrorPayload(res.status, text) }
  }
  return { ok: true, data: parseJsonText(text) }
}

// Lazy so importing this module (e.g. when the compiled binary delegates unknown
// commands to cli/bakin.ts) does not initialize runtime services at startup.
let __cliAgent: string | undefined
export async function getCliAgent(): Promise<string> {
  if (__cliAgent === undefined) {
    const roster = await getCliRoster()
    __cliAgent = roster.mainAgentId ?? roster.agentIds[0] ?? 'main'
  }
  return __cliAgent
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
