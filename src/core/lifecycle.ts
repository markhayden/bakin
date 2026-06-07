/**
 * Lifecycle management — startup and graceful shutdown.
 */
import type { Server } from 'http'
import { createLogger } from './logger'
import { appendAudit } from './audit'
import * as sse from './sse'
import * as dispatch from './dispatch'
import * as watchdog from './watchdog'
import * as watcher from './watcher'
import * as doctor from './doctor'
import { maybeGetAppServices } from './app-services'
import { closeDb } from '../../packages/core/src/storage/db'
import { releaseServerLock } from './server-lock'
import { pluginRegistry } from '../lib/plugin-registry'

const log = createLogger('lifecycle')

let shutdownInProgress = false
let registered: { server: Server; contentDir: string } | null = null

/** Tests use this between cases — bun:test has no vi.resetModules equivalent. */
export function _resetShutdownStateForTests(): void {
  shutdownInProgress = false
  registered = null
}

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shutdownInProgress) return
  shutdownInProgress = true

  log.info(`Shutdown initiated (${signal})`)

  // Shut down plugins first (reverse activation order)
  await pluginRegistry.shutdownAll()

  // Stop accepting new work
  dispatch.stop()
  watchdog.stop()
  doctor.stop()

  // Stop file watching
  await watcher.stop()

  // Shut down adapter-owned resources (includes the antfly child — the
  // EADDRINUSE path MUST reach here or the child is orphaned, #459).
  await maybeGetAppServices()?.search.shutdown()

  // Drain SSE clients
  sse.stop()

  // Close HTTP server
  registered?.server.close(() => {
    log.info('HTTP server closed')
  })

  // Write shutdown audit entry
  if (registered) {
    appendAudit(registered.contentDir, 'system.shutdown', 'system', { signal, exitCode })
  }

  // Close the execution-ledger handle (checkpoints WAL — disk hygiene; a
  // crash without this is still safe, SQLite recovers on next open).
  closeDb()

  // Release the singleton lock (no-op if this process doesn't hold it)
  releaseServerLock()

  // Give time for final writes
  setTimeout(() => {
    log.info('Shutdown complete')
    process.exit(exitCode)
  }, 1000)
}

/**
 * Run the full graceful-shutdown chain outside a signal — fatal startup
 * failures (EADDRINUSE) use this so children (antfly) are stopped instead
 * of orphaned, then exit non-zero.
 */
export function triggerShutdown(reason: string, exitCode = 1): void {
  void shutdown(reason, exitCode).catch((err) => {
    log.error('Forced shutdown failed — exiting hard', err)
    releaseServerLock()
    process.exit(exitCode)
  })
}

export function registerShutdownHandlers(server: Server, contentDir: string): void {
  registered = { server, contentDir }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  log.info('Shutdown handlers registered')
}
