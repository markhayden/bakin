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

export interface DevShutdownDeps {
  proc: DevShutdownProc
  killTailwind: () => void
  warn: (message: string) => void
}

export function registerDevShutdown({ proc, killTailwind, warn }: DevShutdownDeps): void {
  let signalCount = 0

  const onSignal = (signal: 'SIGINT' | 'SIGTERM') => {
    signalCount++
    if (signalCount > 1) {
      warn(`second ${signal} during shutdown — forcing exit`)
      proc.exit(130)
      return
    }
    killTailwind()
    // Sole listener → build phase, the server hasn't registered its
    // lifecycle handlers yet: we own the exit. Otherwise the lifecycle
    // listener (registered later on this same signal) runs next and
    // owns the full graceful shutdown + exit.
    if (proc.listenerCount(signal) <= 1) proc.exit(0)
  }

  proc.on('SIGINT', () => onSignal('SIGINT'))
  proc.on('SIGTERM', () => onSignal('SIGTERM'))
  proc.on('exit', killTailwind)
}
