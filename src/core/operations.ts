/**
 * The app's operations registry (#895) — one per process, HMR-safe on
 * globalThis like the SSE broadcaster. Wires the core registry to SSE
 * (`operation.updated` in the plugin-event envelope: milestones replayable via
 * `broadcast`, ticks live-only via `broadcastEphemeral`), the audit log and
 * the server log. Broadcast is reached through the globals `sse.ts` installs,
 * so the CLI's in-process mode can run operations without loading the server.
 */
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

function publish(view: OperationView, kind: 'milestone' | 'tick'): void {
  const send = kind === 'milestone' ? g.__bakinBroadcast : g.__bakinBroadcastEphemeral
  send?.({ type: 'plugin-event', event: OPERATION_UPDATED_EVENT, view, timestamp: new Date().toISOString() })
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

/** SIGTERM: note "Server stopping" in every live operation. No-op if none ever started. */
export function noteOperationsShutdown(): void {
  g.__bakinOperationRegistry?.shutdown()
}

/** Tests: drop the process registry (stopping its timers). */
export function _resetOperationRegistryForTests(): void {
  g.__bakinOperationRegistry?.dispose()
  g.__bakinOperationRegistry = undefined
}
