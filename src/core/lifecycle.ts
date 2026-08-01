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
import { shutdownDeliveryBridge } from './delivery'
import { closeDb } from '../../packages/core/src/storage/db'
import { releaseServerLock } from './server-lock'
import { pluginRegistry } from './plugin-registry'

const log = createLogger('lifecycle')

// Hard ceiling on graceful shutdown: if cleanup hasn't exited the process by
// now, force it. Bounds the dev-loop Ctrl-C so a stuck step can't hang the
// session until a second signal.
const SHUTDOWN_FORCE_EXIT_MS = 4000
// If process.exit() returns but the process is still alive, a spawned child or
// native handle is wedged. Give stdout/stderr a beat, then use the same kind of
// hard process termination the dev loop uses on a second Ctrl-C.
const POST_EXIT_HARD_KILL_MS = 250

let shutdownInProgress = false
let registered: { server: Server; contentDir: string } | null = null
let hardTerminateForTests: ((exitCode: number) => void) | null = null
let postExitHardKillTimer: ReturnType<typeof setTimeout> | null = null

function hardTerminate(exitCode: number): void {
  process.exitCode = exitCode
  if (hardTerminateForTests) {
    hardTerminateForTests(exitCode)
    return
  }
  try {
    process.kill(process.pid, 'SIGKILL')
  } catch {
    process.exit(exitCode)
  }
}

function exitWithHardFallback(exitCode: number): void {
  if (postExitHardKillTimer) clearTimeout(postExitHardKillTimer)
  postExitHardKillTimer = setTimeout(() => {
    log.warn('Process exit did not terminate — forcing hard exit')
    hardTerminate(exitCode)
  }, POST_EXIT_HARD_KILL_MS)
  // Deliberately NOT unref'd — same reasoning as dev-shutdown's backstop:
  // this timer's only job is to fire when Bun's process.exit() wedges on a
  // live child/native handle, and an unref'd timer may never run in that
  // state. In the normal path process.exit() terminates before it matters.
  process.exit(exitCode)
}

/** Tests use this between cases — bun:test has no vi.resetModules equivalent. */
export function _resetShutdownStateForTests(): void {
  shutdownInProgress = false
  registered = null
  hardTerminateForTests = null
  if (postExitHardKillTimer) clearTimeout(postExitHardKillTimer)
  postExitHardKillTimer = null
}

export function _setHardTerminateForTests(fn: ((exitCode: number) => void) | null): void {
  hardTerminateForTests = fn
}

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shutdownInProgress) return
  shutdownInProgress = true

  log.info(`Shutdown initiated (${signal})`)

  // Backstop: guarantee the process exits even if a cleanup step below throws
  // or hangs. Previously the force-exit was the LAST statement, so a throw in
  // closeDb()/releaseServerLock() (or a step that never resolved) skipped it
  // and left the event loop alive on the HTTP server's lingering SSE keep-alive
  // sockets — the dev session hung until a second Ctrl-C. unref() so this timer
  // never by itself keeps the loop alive.
  const forceExit = setTimeout(() => {
    log.warn('Graceful shutdown timed out — forcing exit')
    hardTerminate(exitCode)
  }, SHUTDOWN_FORCE_EXIT_MS)
  forceExit.unref?.()

  try {
    // Shut down plugins first (reverse activation order)
    await pluginRegistry.shutdownAll()

    // Stop accepting new work
    dispatch.stop()
    watchdog.stop()
    doctor.stop()

    // Stop file watching
    await watcher.stop()

    // Disconnect the Discord delivery bridge (no-op when never booted).
    await shutdownDeliveryBridge()

    // Release adapter-owned resources. The antfly child is deliberately LEFT
    // RUNNING (keep-alive lifecycle): the next boot adopts the warm instance
    // instead of repaying model load + startup convergence. Explicit kills:
    // `bakin stop`, or a pin/settings change detected at adoption time.
    await maybeGetAppServices()?.search.shutdown()

    // Drain SSE clients
    sse.stop()

    // Close HTTP server. Destroy any still-open connections first — SSE
    // keep-alive sockets otherwise keep server.close() pending forever, which
    // holds the event loop open and is the actual reason a stalled shutdown
    // never exits on its own.
    if (registered) {
      registered.server.closeAllConnections?.()
      registered.server.close(() => {
        log.info('HTTP server closed')
      })
      // Write shutdown audit entry
      appendAudit(registered.contentDir, 'system.shutdown', 'system', { signal, exitCode })
    }

    // Close the execution-ledger handle (checkpoints WAL — disk hygiene; a
    // crash without this is still safe, SQLite recovers on next open).
    closeDb()

    // Release the singleton lock (no-op if this process doesn't hold it)
    releaseServerLock()
  } catch (err) {
    log.error('Error during graceful shutdown — exiting anyway', err)
  } finally {
    clearTimeout(forceExit)
    log.info('Shutdown complete')
    exitWithHardFallback(exitCode)
  }
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
    exitWithHardFallback(exitCode)
  })
}

export function registerShutdownHandlers(server: Server, contentDir: string): void {
  registered = { server, contentDir }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  log.info('Shutdown handlers registered')
}
