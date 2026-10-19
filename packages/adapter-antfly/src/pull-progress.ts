import { statSync } from 'fs'
import { basename, dirname, join } from 'path'

/**
 * Progress for `antfly inference pull` (#895 D12, `tasks/evidence-antfly-pull.md`).
 *
 * The pull writes nothing to stdout; stderr carries a line protocol:
 *
 *   pulling BAAI/bge-small-en-v1.5...
 *     [9/10] onnx/model.onnx (126.9 MiB)...                          ← a file starts
 *     [9/10] onnx/model.onnx 16.0 MiB/126.9 MiB (13%) 2.9 MiB/s …   ← every 16 MiB
 *     [9/10] onnx/model.onnx done (126.9 MiB, 3.3 MiB/s, 38.0s)      ← or `cached (…)`
 *   done.
 *
 * Structure and announced sizes come from those lines; bytes between the
 * 16 MiB lines come from the in-flight `<path>.part` in the model's staging
 * dir. The total is the running sum of announced sizes, so it grows as files
 * start — pinned bytes are never a total (a pull fetches ~2× the weights).
 */

export type PullLine =
  | { kind: 'start'; path: string; size: number }
  | { kind: 'progress'; path: string; received: number; size: number }
  | { kind: 'finished'; path: string; size: number }
  | { kind: 'other' }

const UNITS: Record<string, number> = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, KB: 1000, MB: 1000 ** 2, GB: 1000 ** 3 }
const SIZE = String.raw`(\d+(?:\.\d+)?) (B|KiB|MiB|GiB|KB|MB|GB)`
const START = new RegExp(String.raw`^\[\d+/\d+\] (\S+) \(${SIZE}\)\.\.\.$`)
const PROGRESS = new RegExp(String.raw`^\[\d+/\d+\] (\S+) ${SIZE}/${SIZE} \(`)
const FINISHED = new RegExp(String.raw`^\[\d+/\d+\] (\S+) (?:done|cached) \(${SIZE}[,)]`)

function bytes(value: string, unit: string): number {
  return Math.round(Number(value) * (UNITS[unit] ?? 1))
}

export function parsePullLine(raw: string): PullLine {
  const line = raw.trim()
  let m = START.exec(line)
  if (m) return { kind: 'start', path: m[1]!, size: bytes(m[2]!, m[3]!) }
  m = PROGRESS.exec(line)
  if (m) return { kind: 'progress', path: m[1]!, received: bytes(m[2]!, m[3]!), size: bytes(m[4]!, m[5]!) }
  m = FINISHED.exec(line)
  if (m) return { kind: 'finished', path: m[1]!, size: bytes(m[2]!, m[3]!) }
  return { kind: 'other' }
}

/** `<root>/<owner>/.<name>.antfly-download-staging` — where in-flight files land (F2). */
/**
 * Where Bakin's pulls land before verification (#898 E): a dot-dir BESIDE
 * the live models root — same filesystem, so publishing is a rename, and
 * outside the tree the engine scans. Stable across runs so an interrupted
 * pull resumes.
 */
export function pullStagingRoot(liveModelsRoot: string): string {
  return join(dirname(liveModelsRoot), `.${basename(liveModelsRoot)}.bakin-pull`)
}

export function pullStagingDir(modelsRoot: string, model: string): string {
  const owned = join(modelsRoot, model)
  const name = owned.slice(dirname(owned).length + 1)
  return join(dirname(owned), `.${name}.antfly-download-staging`)
}

/** Bytes for one model's pull: finished files plus the current file's progress. */
export function createPullTracker(stagingDir: string) {
  const announced = new Map<string, number>()
  const finished = new Set<string>()
  let current: string | null = null
  let currentReceived = 0

  const partSize = (path: string): number => {
    try {
      return statSync(join(stagingDir, `${path}.part`)).size
    } catch {
      return 0
    }
  }

  return {
    /** Feed one stderr line; true when it changed the byte picture. */
    line(raw: string): boolean {
      const parsed = parsePullLine(raw)
      switch (parsed.kind) {
        case 'start':
          announced.set(parsed.path, parsed.size)
          current = parsed.path
          currentReceived = 0
          return true
        case 'progress':
          announced.set(parsed.path, parsed.size)
          current = parsed.path
          currentReceived = Math.max(currentReceived, parsed.received)
          return true
        case 'finished':
          announced.set(parsed.path, parsed.size)
          finished.add(parsed.path)
          if (current === parsed.path) {
            current = null
            currentReceived = 0
          }
          return true
        default:
          return false
      }
    },
    /** Received and total so far, reading the current `.part` for bytes between lines. */
    snapshot(): { received: number; total: number } {
      let received = 0
      for (const path of finished) received += announced.get(path) ?? 0
      if (current && !finished.has(current)) {
        const size = announced.get(current) ?? 0
        currentReceived = Math.min(size, Math.max(currentReceived, partSize(current)))
        received += currentReceived
      }
      let total = 0
      for (const size of announced.values()) total += size
      return { received, total }
    },
  }
}
