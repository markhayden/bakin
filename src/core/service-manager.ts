/**
 * The LOADED Bakin service's main pid (#898 K) — the only evidence that the
 * OS service manager runs a given process. The file on disk (plist / unit)
 * describes the NEXT launch, never the current process. `launchctl print`
 * is not an API: only an unambiguous single `pid = N` line counts; anything
 * else is null (unknown ⇒ callers never drive the service).
 */
import { execFileSync } from 'child_process'

export const BAKIN_SERVICE_LABEL = 'com.makinbakin.bakin'
/** A stuck manager must never hang /api/restart. */
const SERVICE_QUERY_TIMEOUT_MS = 5_000

export function parseLaunchctlPid(output: string): number | null {
  // Only the job's own top-level key (one tab deep), never a nested block's.
  const pids = [...output.matchAll(/^\tpid = (\d+)\s*$/gm)].map((m) => Number(m[1]))
  return pids.length === 1 && pids[0]! > 0 ? pids[0]! : null
}

export function parseSystemdMainPid(output: string): number | null {
  const pid = Number(/^MainPID=(\d+)$/m.exec(output)?.[1])
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

/** The running service's pid, or null when not loaded / not running / unreadable. */
export function loadedServicePid(platform: string = process.platform): number | null {
  try {
    if (platform === 'darwin') {
      const uid = String(process.getuid?.() ?? execFileSync('id', ['-u'], { encoding: 'utf-8', timeout: SERVICE_QUERY_TIMEOUT_MS, killSignal: 'SIGKILL' }).trim())
      return parseLaunchctlPid(execFileSync('launchctl', ['print', `gui/${uid}/${BAKIN_SERVICE_LABEL}`], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: SERVICE_QUERY_TIMEOUT_MS, killSignal: 'SIGKILL' }))
    }
    if (platform === 'linux') {
      return parseSystemdMainPid(execFileSync('systemctl', ['--user', 'show', `${BAKIN_SERVICE_LABEL}.service`, '-p', 'MainPID'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: SERVICE_QUERY_TIMEOUT_MS, killSignal: 'SIGKILL' }))
    }
  } catch {
    return null // not loaded, or the manager is unavailable: no evidence
  }
  return null
}
