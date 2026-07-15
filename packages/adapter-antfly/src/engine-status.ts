/**
 * Engine-process introspection behind SearchAdapter.engineStatus() — the
 * doctor's burn watchdog reads this to catch a wedged engine (the
 * 2026-07-12 incident: a zero-progress startup catch-up loop pinned the
 * engine at 200% CPU for 17h while every query starved).
 *
 * Two signals, both measured SINCE THE PREVIOUS CALL so the doctor's own
 * cadence is the sampling window (same pattern as the search-spin check):
 *
 *  - cpuUtilization: Δ cumulative process CPU time / Δ wall clock, from
 *    one `ps -o time=` read per call. Null on the first sample, a pid
 *    change, or a mode where the pid is unknowable (guest).
 *  - wedgeSignals: known zero-progress signatures counted in the NEW bytes
 *    of the engine log (byte-offset tail scan, rotation-safe). A signature
 *    must recur several times within one window to count — a single line
 *    is noise, a loop is a wedge.
 */
import { openSync, readSync, closeSync, statSync } from 'fs'
import { createLogger } from '@bakin/core/logger'
import type { SearchEngineStatus } from '@bakin/core/adapters/search'
import type { AntflySettings } from './defaults'
import {
  LAUNCHD_LABEL,
  SYSTEMD_UNIT,
  childPid,
  defaultServiceIo,
  detectServiceMode,
  servicePaths,
  type ServiceIo,
} from './service'

const log = createLogger('antfly-engine-status')

/** A signature must appear this many times in one window's log delta. */
const WEDGE_MIN_OCCURRENCES = 3
/** Never read more than this much log per probe (a flooding engine). */
const MAX_TAIL_BYTES = 512 * 1024

/**
 * Known engine wedge signatures (each line = one loop iteration). A pattern
 * may override the occurrence floor: signatures that also appear in benign
 * bursts (a client dropping mid-restart emits a handful of SendFailed
 * lines) need a floor only a sustained loop can reach within one ~30-min
 * doctor window.
 */
const WEDGE_PATTERNS: ReadonlyArray<{ signal: string; pattern: RegExp; minOccurrences?: number }> = [
  // The startup catch-up loop re-opening/closing a table group forever
  // ("provisioned startup catch-up debt persists", one line per ~2s spin).
  { signal: 'startup-catchup-spin', pattern: /catch-up debt persists/g },
  // The 2026-07-14 lock-contention wedge: the engine spammed
  // "Connection error: error.SendFailed" for a day with NO catch-up-debt
  // lines, so the watchdog saw only high CPU and never escalated. A few
  // lines are a normal disconnect; a storm is a wedged I/O loop.
  { signal: 'connection-send-failed-storm', pattern: /error\.SendFailed/g, minOccurrences: 50 },
  // Same incident: route handlers repeatedly failing with TableReadChurn
  // while the engine still answered health probes.
  { signal: 'table-read-churn', pattern: /error\.TableReadChurn/g, minOccurrences: 10 },
]

interface ProbeState {
  pid: number | null
  cpuSeconds: number | null
  at: number
  logOffset: number | null
}

/** Parse `ps -o time=` cumulative CPU ([[dd-]hh:]mm:ss) into seconds. */
export function parsePsCpuTime(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  const dayMatch = /^(\d+)-(.+)$/.exec(text)
  const days = dayMatch ? Number(dayMatch[1]) : 0
  const parts = (dayMatch ? dayMatch[2] : text).split(':').map(Number)
  if (parts.some(Number.isNaN) || parts.length < 2 || parts.length > 3) return null
  const [h, m, sec] = parts.length === 3 ? parts : [0, parts[0], parts[1]]
  return days * 86_400 + h * 3600 + m * 60 + sec
}

/**
 * Count wedge signatures in the log's new bytes; advance the offset.
 * `prevOffset: null` = first probe — baseline to EOF without scanning, so
 * historical spam from an already-fixed incident never fires a signal.
 */
export function scanLogDelta(
  logFile: string,
  prevOffset: number | null,
): { signals: string[]; nextOffset: number } {
  let size: number
  try {
    size = statSync(logFile).size
  } catch {
    return { signals: [], nextOffset: 0 } // no log yet
  }
  if (prevOffset === null) return { signals: [], nextOffset: size }
  // Rotation/truncation: the file shrank — start over from the tail.
  let from = prevOffset > size ? Math.max(0, size - MAX_TAIL_BYTES) : prevOffset
  if (size - from > MAX_TAIL_BYTES) from = size - MAX_TAIL_BYTES
  if (size === from) return { signals: [], nextOffset: size }

  const length = size - from
  const buffer = Buffer.alloc(length)
  try {
    const fd = openSync(logFile, 'r')
    try {
      readSync(fd, buffer, 0, length, from)
    } finally {
      closeSync(fd)
    }
  } catch (err) {
    // Fails safe (offset preserved, no false signals) but never silently:
    // a persistently unreadable log would blind the wedge watchdog.
    log.warn('engine log read failed — wedge scan skipped this window', {
      logFile,
      err: err instanceof Error ? err.message : String(err),
    })
    return { signals: [], nextOffset: prevOffset }
  }
  const delta = buffer.toString('utf-8')
  const signals = WEDGE_PATTERNS.filter(({ pattern, minOccurrences }) => {
    const count = delta.match(pattern)?.length ?? 0
    return count >= (minOccurrences ?? WEDGE_MIN_OCCURRENCES)
  }).map(({ signal }) => signal)
  return { signals, nextOffset: size }
}

async function resolvePid(settings: AntflySettings, io: ServiceIo): Promise<number | null> {
  const mode = detectServiceMode(settings, io)
  if (mode === 'guest') return null
  if (mode === 'child') return childPid()
  if (mode === 'launchd') {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 501
    const result = await io.exec('launchctl', ['print', `gui/${uid}/${LAUNCHD_LABEL}`])
    if (result.code !== 0) return null
    const match = /^\s*pid = (\d+)/m.exec(result.stdout)
    return match ? Number(match[1]) : null
  }
  // systemd: MainPID=0 means not running
  const result = await io.exec('systemctl', ['--user', 'show', '-p', 'MainPID', '--value', SYSTEMD_UNIT])
  if (result.code !== 0) return null
  const pid = Number(result.stdout.trim())
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

/**
 * One probe per adapter instance — the state (previous CPU sample + log
 * offset) is what turns point reads into rates.
 */
export function createEngineStatusProbe(
  getSettings: () => AntflySettings,
  io: ServiceIo = defaultServiceIo(),
): () => Promise<SearchEngineStatus | null> {
  let state: ProbeState | null = null

  return async (): Promise<SearchEngineStatus | null> => {
    const settings = getSettings()
    const mode = detectServiceMode(settings, io)
    if (mode === 'guest') return null // externally managed — not ours to measure

    const now = Date.now()
    const pid = await resolvePid(settings, io)
    if (pid === null) {
      state = { pid: null, cpuSeconds: null, at: now, logOffset: state?.logOffset ?? null }
      return { running: false, cpuUtilization: null, wedgeSignals: [] }
    }

    let cpuSeconds: number | null = null
    try {
      const ps = await io.exec('ps', ['-o', 'time=', '-p', String(pid)])
      cpuSeconds = ps.code === 0 ? parsePsCpuTime(ps.stdout) : null
    } catch (err) {
      log.warn('engine cpu sample failed', { err: err instanceof Error ? err.message : String(err) })
    }

    const samePid = state?.pid === pid
    const utilization =
      samePid && state && state.cpuSeconds !== null && cpuSeconds !== null && now > state.at
        ? Math.max(0, (cpuSeconds - state.cpuSeconds) / ((now - state.at) / 1000))
        : null

    const { signals, nextOffset } = scanLogDelta(servicePaths().logFile, state?.logOffset ?? null)
    state = { pid, cpuSeconds, at: now, logOffset: nextOffset }

    return { running: true, pid, cpuUtilization: utilization, wedgeSignals: signals }
  }
}
