/**
 * Dev-loop shutdown signal handling (#459 defect 1).
 *
 * scripts/dev.ts registers its SIGINT/SIGTERM handlers BEFORE importing
 * server.ts, and signal listeners run in registration order. The old
 * handler called process.exit(0) synchronously, which preempted the
 * lifecycle shutdown chain (src/core/lifecycle.ts) registered later on
 * the same signals — orphaning the antfly child on :3738.
 *
 * The rule here: the dev handler always owns the tailwind child, but only
 * owns the EXIT while it is the sole signal listener (the build phase,
 * before server boot). Once lifecycle.registerShutdownHandlers() has added
 * its listener, the dev handler falls through and lets the lifecycle chain
 * (plugins → dispatch → watcher → search.shutdown()/antfly → …) run and
 * exit. A second signal is the operator escape hatch for a hung graceful
 * shutdown: warn and force-exit 130.
 *
 * Extracted from dev.ts with the process object injected so tests can
 * drive it with a fake — emitting real signals would kill the test runner.
 */

export interface DevShutdownProc {
  on(event: string, listener: (...args: unknown[]) => void): unknown
  listenerCount(event: string): number
  exit(code?: number): void
}

// Hard ceiling on the graceful chain. If the lifecycle shutdown hasn't exited
// the process by now, force-kill it — so ONE Ctrl-C is always enough.
const DEV_SHUTDOWN_GRACE_MS = 6000

export interface DevShutdownDeps {
  proc: DevShutdownProc
  killTailwind: () => void
  warn: (message: string) => void
  /** Force-terminate the process. Defaults to a self-SIGKILL (which always
   *  works, even when proc.exit() doesn't terminate due to a live spawned
   *  antfly child). Injectable so tests don't actually kill the runner. */
  forceKill?: () => void
}

export function registerDevShutdown({ proc, killTailwind, warn, forceKill }: DevShutdownDeps): void {
  let signalCount = 0
  const hardKill = forceKill ?? (() => {
    try {
      process.kill(process.pid, 'SIGKILL')
    } catch {
      proc.exit(137)
    }
  })

  const onSignal = (signal: 'SIGINT' | 'SIGTERM') => {
    signalCount++
    if (signalCount > 1) {
      warn(`second ${signal} — forcing immediate exit`)
      hardKill()
      return
    }
    // Immediate feedback so a multi-second graceful chain doesn't look hung.
    warn('shutting down — stopping antfly, plugins, and watchers…')
    killTailwind()
    // Sole listener → build phase, the server hasn't registered its lifecycle
    // handlers yet: we own the exit. Otherwise the lifecycle listener (later,
    // same signal) runs the graceful chain and owns the exit.
    if (proc.listenerCount(signal) <= 1) {
      proc.exit(0)
      return
    }
    // Guarantee termination even if the graceful chain hangs OR proc.exit()
    // doesn't actually terminate (Bun + a live spawned child). A SINGLE Ctrl-C
    // is then always enough — no second signal needed.
    const backstop = setTimeout(() => {
      warn('graceful shutdown took too long — forcing exit')
      hardKill()
    }, DEV_SHUTDOWN_GRACE_MS)
  }

  proc.on('SIGINT', () => onSignal('SIGINT'))
  proc.on('SIGTERM', () => onSignal('SIGTERM'))
  proc.on('exit', killTailwind)
}
