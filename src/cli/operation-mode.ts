/**
 * Where an install-class CLI verb runs (#895 D11): against this home's server
 * or in-process.
 *
 * - An explicit `BAKIN_URL` means server-only; unreachable is an error.
 * - Otherwise a live `server.lock` in this home picks the server at its port,
 *   and the lock's `cliSecret` rides along as `X-Bakin-Cli-Secret` — the
 *   proof this CLI can read that home's lock, which is what lets a request
 *   claim the search service.
 * - No lock (or a dead pid) means in-process.
 *
 * A lock-chosen server that refuses the connection before anything was sent
 * has died since the lock was read: the verb runs in-process. Once a request
 * reached a server, nothing falls back — a failure after send is an error.
 */
import { readLiveServerLock, type ServerLock } from '../core/server-lock'

export const CLI_SECRET_HEADER = 'X-Bakin-Cli-Secret'

export type OperationMode =
  | { kind: 'server'; source: 'env' | 'lock'; baseUrl: string; headers: Record<string, string> }
  | { kind: 'local' }

export function selectOperationMode(
  env: Record<string, string | undefined>,
  lock: Pick<ServerLock, 'pid' | 'port' | 'cliSecret'> | null,
): OperationMode {
  if (env.BAKIN_URL) return { kind: 'server', source: 'env', baseUrl: env.BAKIN_URL.replace(/\/+$/, ''), headers: {} }
  if (lock && Number.isInteger(lock.port) && lock.port > 0) {
    return {
      kind: 'server',
      source: 'lock',
      baseUrl: `http://localhost:${lock.port}`,
      headers: lock.cliSecret ? { [CLI_SECRET_HEADER]: lock.cliSecret } : {},
    }
  }
  return { kind: 'local' }
}

/** This CLI's mode, resolved now (re-reads the lock). */
export function currentOperationMode(env: Record<string, string | undefined> = process.env): OperationMode {
  return selectOperationMode(env, readLiveServerLock())
}

/** A server target with a `fetch` that records whether any request reached it. */
export interface ServerTarget {
  baseUrl: string
  headers: Record<string, string>
  fetch: (path: string, init?: RequestInit) => Promise<Response>
}

export class ServerUnreachableError extends Error {
  constructor(baseUrl: string, cause: unknown) {
    super(`Can't reach the Bakin server at ${baseUrl} (BAKIN_URL). Check that it is running, or unset BAKIN_URL to use this home's server.`)
    this.name = 'ServerUnreachableError'
    this.cause = cause
  }
}

/** Bun's typed code for a refused TCP connect: nothing was sent. */
function refusedBeforeSend(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'ConnectionRefused' || (err as { code?: unknown } | null)?.code === 'ECONNREFUSED'
}

export async function runInOperationMode<T>(
  mode: OperationMode,
  impl: { server: (target: ServerTarget) => Promise<T>; local: () => Promise<T> },
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = (input, init) => fetch(input, init),
): Promise<T> {
  if (mode.kind === 'local') return impl.local()
  let reached = false
  const target: ServerTarget = {
    baseUrl: mode.baseUrl,
    headers: mode.headers,
    fetch: async (path, init) => {
      try {
        const res = await fetchImpl(`${mode.baseUrl}${path}`, { ...init, headers: { ...mode.headers, ...init?.headers } })
        reached = true
        return res
      } catch (err) {
        if (!refusedBeforeSend(err)) reached = true
        throw err
      }
    },
  }
  try {
    return await impl.server(target)
  } catch (err) {
    if (reached || !refusedBeforeSend(err)) throw err
    if (mode.source === 'env') throw new ServerUnreachableError(mode.baseUrl, err)
    return impl.local()
  }
}
