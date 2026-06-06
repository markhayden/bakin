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
import { pluginRegistry } from '../lib/plugin-registry'

const log = createLogger('lifecycle')

let shutdownInProgress = false

/**
 * True once the lifecycle owns SIGINT/SIGTERM. scripts/dev.ts registers its
 * own (earlier) signal handlers for the pre-server boot window; they consult
 * this to know they must NOT call process.exit and preempt the async
 * shutdown below — doing so orphaned the antfly child every time (#459).
 */
export function lifecycleOwnsShutdown(): boolean {
  return (globalThis as Record<string, unknown>).__bakinLifecycleOwnsShutdown === true
}

/** Tests use this between cases — bun:test has no vi.resetModules equivalent. */
export function _resetShutdownStateForTests(): void {
  shutdownInProgress = false
  delete (globalThis as Record<string, unknown>).__bakinLifecycleOwnsShutdown
}

export function registerShutdownHandlers(server: Server, contentDir: string): void {
  const shutdown = async (signal: string) => {
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

    // Shut down adapter-owned resources.
    await maybeGetAppServices()?.search.shutdown()

    // Drain SSE clients
    sse.stop()

    // Close HTTP server
    server.close(() => {
      log.info('HTTP server closed')
    })

    // Write shutdown audit entry
    appendAudit(contentDir, 'system.shutdown', 'system', { signal })

    // Give time for final writes
    setTimeout(() => {
      log.info('Shutdown complete')
      // Honor a pre-set failure code (e.g. EADDRINUSE at listen time, #459)
      // instead of stamping success over it.
      process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0)
    }, 1000)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  ;(globalThis as Record<string, unknown>).__bakinLifecycleOwnsShutdown = true

  log.info('Shutdown handlers registered')
}
