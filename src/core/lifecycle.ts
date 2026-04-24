/**
 * Lifecycle management — startup and graceful shutdown.
 */
import type { Server } from 'http'
import { createLogger } from './logger'
import { appendAudit } from './audit'
import * as sse from './sse'
import * as dispatch from './dispatch'
import * as watchdog from './watchdog'
import * as messagingCron from './messaging-cron'
import * as watcher from './watcher'
import * as doctor from './doctor'
import * as antflyServer from './antfly-server'
import { pluginRegistry } from '../lib/plugin-registry'

const log = createLogger('lifecycle')

let shutdownInProgress = false

/** Tests use this between cases — bun:test has no vi.resetModules equivalent. */
export function _resetShutdownStateForTests(): void {
  shutdownInProgress = false
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
    messagingCron.stop()
    doctor.stop()

    // Stop file watching
    await watcher.stop()

    // Stop Antfly server (if we started it)
    antflyServer.stop()

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
      process.exit(0)
    }, 1000)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  log.info('Shutdown handlers registered')
}
