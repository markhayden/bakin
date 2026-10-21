/**
 * Server-side restart scheduling for browser-initiated self-updates.
 *
 * The HTTP route must return before the current process exits. For managed
 * services we ask the service manager to restart us after a short delay. For
 * standalone runs we start a detached child that waits for this parent PID to
 * disappear before booting the replacement binary.
 */
import { accessSync, constants as fsConstants } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { getContentDir } from './content-dir'
import { loadedServicePid } from './service-manager'
import { createLogger } from './logger'

/** A stuck service manager must never block the server's event loop. */
const SERVICE_COMMAND_TIMEOUT_MS = 10_000

const SERVICE_LABEL = 'com.makinbakin.bakin'
const RESTART_CHILD_COMMAND = '__bakin-restart-child'
const DEFAULT_RESTART_DELAY_MS = 750
const PARENT_EXIT_POLL_MS = 250
const PARENT_EXIT_MAX_WAIT_MS = 60_000

const log = createLogger('server-restart')

export interface RestartScheduleResult {
  ok: boolean
  strategy: 'launchagent' | 'systemd' | 'standalone-child'
  restartDelayMs: number
  childPid?: number
  error?: string
  /**
   * The deferred command's own outcome (the service kick or the parent
   * signal, `restartDelayMs` later): `ok` once it ran; `{ ok: false }` when
   * it failed — the process is still here and whoever waited on the restart
   * must fail instead of waiting forever (#1007 review r3 #3).
   */
  settled?: Promise<{ ok: true } | { ok: false; error: string }>
}

type Settled = { ok: true } | { ok: false; error: string }
function deferred(): { promise: Promise<Settled>; resolve: (value: Settled) => void } {
  let resolve!: (value: Settled) => void
  const promise = new Promise<Settled>((r) => { resolve = r })
  return { promise, resolve }
}

export function restartChildCommandName(): string {
  return RESTART_CHILD_COMMAND
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const maybeTimer = timer as { unref?: () => void }
  if (typeof maybeTimer.unref === 'function') maybeTimer.unref()
}

/**
 * The service restarts THIS server only when the loaded service's main pid
 * IS this process (#898 K) — a plist or unit file merely existing is the
 * next launch's config, possibly another home's. Otherwise: the standalone
 * child path.
 */
function serviceRestartStrategy(): 'launchagent' | 'systemd' | null {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return null
  if (loadedServicePid() !== process.pid) return null
  return process.platform === 'darwin' ? 'launchagent' : 'systemd'
}

function scheduleServiceRestart(strategy: 'launchagent' | 'systemd', delayMs: number): RestartScheduleResult {
  const outcome = deferred()
  const timer = setTimeout(() => {
    try {
      if (strategy === 'launchagent') {
        const uid = execFileSync('id', ['-u'], { encoding: 'utf-8', timeout: SERVICE_COMMAND_TIMEOUT_MS, killSignal: 'SIGKILL' }).trim()
        execFileSync('launchctl', ['kickstart', '-k', `gui/${uid}/${SERVICE_LABEL}`], { stdio: 'pipe', timeout: SERVICE_COMMAND_TIMEOUT_MS, killSignal: 'SIGKILL' })
      } else {
        execFileSync('systemctl', ['--user', 'restart', `${SERVICE_LABEL}.service`], { stdio: 'pipe', timeout: SERVICE_COMMAND_TIMEOUT_MS, killSignal: 'SIGKILL' })
      }
      outcome.resolve({ ok: true })
    } catch (err) {
      log.error('Scheduled service restart failed', err as Error, { strategy })
      outcome.resolve({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }, delayMs)
  unrefTimer(timer)

  return { ok: true, strategy, restartDelayMs: delayMs, settled: outcome.promise }
}

function scheduleStandaloneRestart(delayMs: number): RestartScheduleResult {
  const parentPid = process.pid
  try {
    const child = spawn(process.execPath, [RESTART_CHILD_COMMAND, String(parentPid)], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        // The replacement is THIS home's, absolute — never re-resolved
        // against whatever cwd the child starts in.
        BAKIN_HOME: resolve(getContentDir()),
        BAKIN_RESTART_PARENT_PID: String(parentPid),
      },
    })
    child.unref()

    const outcome = deferred()
    const timer = setTimeout(() => {
      try {
        process.kill(parentPid, 'SIGTERM')
        outcome.resolve({ ok: true })
      } catch (err) {
        log.error('Failed to signal parent process for restart', err as Error, { parentPid })
        outcome.resolve({ ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    }, delayMs)
    unrefTimer(timer)

    return {
      ok: true,
      strategy: 'standalone-child',
      restartDelayMs: delayMs,
      childPid: child.pid,
      settled: outcome.promise,
    }
  } catch (err) {
    return {
      ok: false,
      strategy: 'standalone-child',
      restartDelayMs: delayMs,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * A restart proven possible but NOT armed (#1007 D7.11, P19): the self-update
 * operation prepares before the binary swap and activates only after it, so
 * a restart that cannot be scheduled fails the update with the binary
 * unchanged — never a replaced binary and no handoff.
 */
export type PreparedRestart =
  | { ok: true; strategy: 'launchagent' | 'systemd'; delayMs: number }
  | { ok: true; strategy: 'standalone-child'; delayMs: number; execPath: string; contentDir: string }
  | { ok: false; strategy: 'launchagent' | 'systemd' | 'standalone-child'; error: string }

export function prepareServerRestart(delayMs = DEFAULT_RESTART_DELAY_MS, opts: { execPath?: string } = {}): PreparedRestart {
  const serviceStrategy = serviceRestartStrategy()
  if (serviceStrategy) return { ok: true, strategy: serviceStrategy, delayMs }
  // Standalone: the successor command is THIS executable in THIS home; both
  // must resolve now, before anything is swapped.
  const execPath = opts.execPath ?? process.execPath
  try {
    accessSync(execPath, fsConstants.X_OK)
  } catch (err) {
    return { ok: false, strategy: 'standalone-child', error: `the server executable ${execPath} is not runnable (${err instanceof Error ? err.message : String(err)})` }
  }
  let contentDir: string
  try {
    contentDir = resolve(getContentDir())
  } catch (err) {
    return { ok: false, strategy: 'standalone-child', error: `the content directory cannot be resolved (${err instanceof Error ? err.message : String(err)})` }
  }
  return { ok: true, strategy: 'standalone-child', delayMs, execPath, contentDir }
}

/** Arm the restart a `prepareServerRestart` proved: the service kick or the detached successor + the parent signal. */
export function activateServerRestart(prepared: PreparedRestart): RestartScheduleResult {
  if (!prepared.ok) return { ok: false, strategy: prepared.strategy, restartDelayMs: DEFAULT_RESTART_DELAY_MS, error: prepared.error }
  if (prepared.strategy !== 'standalone-child') return scheduleServiceRestart(prepared.strategy, prepared.delayMs)
  return scheduleStandaloneRestart(prepared.delayMs)
}

/** Prepare + activate in one step — the pre-#1007 contract, kept for callers that have nothing to do in between. */
export function scheduleServerRestart(delayMs = DEFAULT_RESTART_DELAY_MS): RestartScheduleResult {
  return activateServerRestart(prepareServerRestart(delayMs))
}

export async function waitForRestartParentExit(parentPidText: string | undefined): Promise<void> {
  const parentPid = Number(parentPidText ?? process.env.BAKIN_RESTART_PARENT_PID)
  if (!Number.isInteger(parentPid) || parentPid <= 0) {
    throw new Error('Missing restart parent PID.')
  }

  // Bounded: a parent that never exits must not leave a child waiting
  // forever to start a competitor later. EPERM means it still exists.
  const deadline = Date.now() + PARENT_EXIT_MAX_WAIT_MS
  for (;;) {
    try {
      process.kill(parentPid, 0)
    } catch (err) {
      if ((err as { code?: string }).code === 'ESRCH') return
    }
    if (Date.now() >= deadline) throw new Error(`Restart parent ${parentPid} did not exit within ${PARENT_EXIT_MAX_WAIT_MS / 1000}s — not starting a competing server.`)
    await new Promise((r) => setTimeout(r, PARENT_EXIT_POLL_MS))
  }
}
