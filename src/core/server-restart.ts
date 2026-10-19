/**
 * Server-side restart scheduling for browser-initiated self-updates.
 *
 * The HTTP route must return before the current process exits. For managed
 * services we ask the service manager to restart us after a short delay. For
 * standalone runs we start a detached child that waits for this parent PID to
 * disappear before booting the replacement binary.
 */
import { resolve } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { getContentDir } from './content-dir'
import { loadedServicePid } from './service-manager'
import { createLogger } from './logger'

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
  const timer = setTimeout(() => {
    try {
      if (strategy === 'launchagent') {
        const uid = execFileSync('id', ['-u'], { encoding: 'utf-8' }).trim()
        execFileSync('launchctl', ['kickstart', '-k', `gui/${uid}/${SERVICE_LABEL}`], { stdio: 'pipe' })
        return
      }
      execFileSync('systemctl', ['--user', 'restart', `${SERVICE_LABEL}.service`], { stdio: 'pipe' })
    } catch (err) {
      log.error('Scheduled service restart failed', err as Error, { strategy })
    }
  }, delayMs)
  unrefTimer(timer)

  return { ok: true, strategy, restartDelayMs: delayMs }
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

    const timer = setTimeout(() => {
      try {
        process.kill(parentPid, 'SIGTERM')
      } catch (err) {
        log.error('Failed to signal parent process for restart', err as Error, { parentPid })
      }
    }, delayMs)
    unrefTimer(timer)

    return {
      ok: true,
      strategy: 'standalone-child',
      restartDelayMs: delayMs,
      childPid: child.pid,
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

export function scheduleServerRestart(delayMs = DEFAULT_RESTART_DELAY_MS): RestartScheduleResult {
  const serviceStrategy = serviceRestartStrategy()
  if (serviceStrategy) return scheduleServiceRestart(serviceStrategy, delayMs)
  return scheduleStandaloneRestart(delayMs)
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
