/**
 * The app's operations registry (#895) — one per process, HMR-safe on
 * globalThis like the SSE broadcaster. Wires the core registry to SSE
 * (`operation.updated` in the plugin-event envelope: milestones replayable via
 * `broadcast`, ticks live-only via `broadcastEphemeral`), the audit log and
 * the server log. Broadcast is reached through the globals `sse.ts` installs,
 * so the CLI's in-process mode can run operations without loading the server.
 */
import { randomUUID } from 'node:crypto'
import {
  createOperationRegistry,
  runLocal as runLocalOn,
  type OperationOrigin,
  type OperationRegistry,
  type OperationView,
  type StartOperationInput,
} from '@bakin/core/operations'
import { appendAudit } from './audit'
import { getBootId } from './boot-id'
import { getContentDir } from './content-dir'
import { createLogger } from './logger'

const log = createLogger('operations')

export const OPERATION_UPDATED_EVENT = 'operation.updated'

type Broadcast = (data: Record<string, unknown>) => void
const g = globalThis as {
  __bakinOperationRegistry?: OperationRegistry
  __bakinBroadcast?: Broadcast
  __bakinBroadcastEphemeral?: Broadcast
}

const AUDIT_CHANNEL: Record<OperationOrigin, 'human' | 'cli' | 'system'> = {
  web: 'human',
  discord: 'human',
  cli: 'cli',
  system: 'system',
}

type UpdateListener = (view: OperationView) => void
const listeners = new Set<UpdateListener>()

function publish(view: OperationView, kind: 'milestone' | 'tick'): void {
  const send = kind === 'milestone' ? g.__bakinBroadcast : g.__bakinBroadcastEphemeral
  send?.({ type: 'plugin-event', event: OPERATION_UPDATED_EVENT, view, timestamp: new Date().toISOString() })
  for (const listener of listeners) listener(view)
}

/**
 * Every update this process's registry publishes, in-process — how the CLI
 * renders an operation it runs locally (#895 D11), with no server and no SSE.
 * Returns the unsubscribe.
 */
export function subscribeOperationUpdates(listener: UpdateListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getOperationRegistry(): OperationRegistry {
  g.__bakinOperationRegistry ??= createOperationRegistry({
    bootId: getBootId,
    publish,
    audit: (event, data) => appendAudit(getContentDir(), event, 'system', data, AUDIT_CHANNEL[data.origin as OperationOrigin] ?? 'system'),
    log: (level, text, meta) => log[level](text, meta),
  })
  return g.__bakinOperationRegistry
}

/** In-process: run and wait for the terminal view (see `runLocal` in core). */
export function runLocal<B>(input: StartOperationInput<B>): Promise<OperationView<B>> {
  return runLocalOn(getOperationRegistry(), input)
}

/**
 * Run `fn` as a local operation that owns `resources` and hand back its value
 * (rethrowing its error) — for in-process callers that are not operations of
 * their own yet but call writers that assert ownership. It waits visibly for
 * the resources like any operation and is not cancellable.
 */
export async function runOwning<T>(
  input: { kind: string; title: string; resources: string[] },
  fn: () => Promise<T>,
): Promise<T> {
  let value: T | undefined
  let failure: { error: unknown } | undefined
  const view = await runLocal({
    kind: input.kind,
    owner: 'core',
    origin: 'system',
    title: input.title,
    fingerprint: `${input.kind}:${randomUUID()}`,
    resources: input.resources,
    plan: { stages: [{ id: 'run', kind: 'installing', label: input.title }], pointOfNoReturn: 'start' },
    run: async (op) => {
      op.stage('run')
      try {
        value = await fn()
      } catch (error) {
        failure = { error }
        throw error
      }
      return { status: 'succeeded', code: 'ok', httpStatus: 200, body: null }
    },
  })
  if (failure) throw failure.error
  if (view.status !== 'succeeded') throw new Error(`${input.title} did not finish (${view.status})`)
  return value as T
}

/**
 * In-process callers of a converted route (onboarding, say): a 202
 * `{ operationId }` is awaited on this process's registry and answered as the
 * route used to answer — the operation result's status and body. Any other
 * response (a synchronous 4xx) passes through.
 */
export async function awaitOperationResponse(res: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = await res.json().catch(() => ({})) as Record<string, unknown>
  if ((res.status !== 202 && res.status !== 200) || typeof body.operationId !== 'string') return { status: res.status, body }
  const view = await getOperationRegistry().await(body.operationId)
  if (view.result) return { status: view.result.httpStatus, body: (view.result.body ?? {}) as Record<string, unknown> }
  return { status: 500, body: { ok: false, error: view.outcome?.message ?? `${view.title} ${view.status}` } }
}

/** SIGTERM: note "Server stopping" in every live operation. No-op if none ever started. */
export function noteOperationsShutdown(): void {
  g.__bakinOperationRegistry?.shutdown()
}

/** Tests: drop the process registry (stopping its timers). */
export function _resetOperationRegistryForTests(): void {
  g.__bakinOperationRegistry?.dispose()
  g.__bakinOperationRegistry = undefined
}
