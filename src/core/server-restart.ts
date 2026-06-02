/**
 * Server-side restart scheduling for browser-initiated self-updates.
 *
 * The HTTP route must return before the current process exits. For managed
 * services we ask the service manager to restart us after a short delay. For
 * standalone runs we start a detached child that waits for this parent PID to
 * disappear before booting the replacement binary.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { createLogger } from './logger'

const SERVICE_LABEL = 'com.makinbakin.bakin'
const RESTART_CHILD_COMMAND = '__bakin-restart-child'
const DEFAULT_RESTART_DELAY_MS = 750
const PARENT_EXIT_POLL_MS = 250

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

function serviceRestartStrategy(): 'launchagent' | 'systemd' | null {
  if (process.platform === 'darwin') {
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`)
    return existsSync(plistPath) ? 'launchagent' : null
  }
  if (process.platform === 'linux') {
    const unitPath = join(homedir(), '.config', 'systemd', 'user', `${SERVICE_LABEL}.service`)
    return existsSync(unitPath) ? 'systemd' : null
  }
  return null
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

  for (;;) {
    try {
      process.kill(parentPid, 0)
      await new Promise((resolve) => setTimeout(resolve, PARENT_EXIT_POLL_MS))
    } catch {
      return
    }
  }
}
