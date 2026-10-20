/**
 * Server startup publishes `server.lock` only while briefly holding
 * `install-state` (#1007 D7.11, R3‴): an in-process `bakin update` holds
 * that resource continuously from its liveness check through the binary
 * swap, so a server can never start between that check and the swap and
 * find itself serving a half-replaced executable. If another LIVE process
 * holds it, boot waits (bounded) and then exits non-zero.
 */
import { holdNow, ResourceBusyError } from '@bakin/core/operations'
import { acquireServerLock, type AcquireResult } from './server-lock'

export class ServerStartBlockedError extends Error {
  constructor(readonly holderTitle: string, readonly waitedMs: number) {
    super(`an install is in progress (${holderTitle}) — Bakin waited ${Math.round(waitedMs / 1000)}s for it to finish; retry when it has`)
    this.name = 'ServerStartBlockedError'
  }
}

export interface PublishServerLockOptions {
  port: number
  bootId: string
  /** How long to wait for a live install-state holder before giving up. Default 60 s. */
  waitMs?: number
  pollMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export const SERVER_START_INSTALL_WAIT_MS = 60_000

/** `acquireServerLock` under a momentary `install-state` hold, waiting out a live holder up to `waitMs`. */
export async function publishServerLockUnderInstallState(options: PublishServerLockOptions): Promise<AcquireResult> {
  const waitMs = options.waitMs ?? SERVER_START_INSTALL_WAIT_MS
  const pollMs = options.pollMs ?? 500
  const now = options.now ?? (() => Date.now())
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const startedAt = now()
  for (;;) {
    try {
      return await holdNow(['install-state'], { title: 'Bakin server startup', bootId: options.bootId }, async () => acquireServerLock(options.port, options.bootId))
    } catch (err) {
      if (!(err instanceof ResourceBusyError)) throw err
      const waited = now() - startedAt
      if (waited >= waitMs) throw new ServerStartBlockedError(err.holder.title ?? 'another operation', waited)
      await sleep(pollMs)
    }
  }
}
