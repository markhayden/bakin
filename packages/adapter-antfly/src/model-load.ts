/**
 * Whether a model actually LOADS on this machine's pinned engine (#993).
 *
 * A complete, pin-verified download can still fail to load: on Linux the
 * 0.2.2 engine's native backend can't run `antflydb/clipclap` (its ONNX
 * projection fails with error.MissingWeight, and the ONNX runtime isn't in
 * the Linux build) while the same files load on macOS Metal. The engine
 * EXITS when a preloaded model fails to warm, so one unloadable model took
 * every search leg down with it.
 *
 * The engine itself is the only authority: `antfly inference embed <dir>`
 * loads the model the way the server would. The verdict is recorded beside
 * the shared models (`~/.antfly/bakin-model-load.json`), keyed by engine
 * version, platform and the model's download, so a re-pull or an engine
 * bump re-probes. No verdict means unknown — treated as loadable, exactly
 * the behavior before probes existed; a probe that hangs records nothing.
 */
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { antflyHome } from './paths'
import { modelDir, modelStructurallyComplete } from './model-pins'
import { ANTFLY_PIN } from './pin'

export interface ModelLoadVerdict {
  loadable: boolean
  /** The engine's own error when it can't load (e.g. `error.MissingWeight`). */
  reason?: string
  engineVersion: string
  platform: string
  /** Fingerprint of the download the probe loaded. */
  download: string
  probedAt: string
}

type Receipt = Record<string, ModelLoadVerdict>

export const MODEL_LOAD_PROBE_TIMEOUT_MS = 120_000

export function modelLoadReceiptPath(): string {
  return join(antflyHome(), 'bakin-model-load.json')
}

function platformKey(): string {
  return `${process.platform}-${process.arch}`
}

/** What the pull wrote last: a re-pull changes it, so the verdict follows the files. */
function downloadFingerprint(model: string): string | null {
  const root = modelDir(model)
  for (const marker of ['.antfly-download-complete.json', 'model_manifest.json']) {
    const path = join(root, marker)
    if (!existsSync(path)) continue
    try {
      return createHash('sha256').update(readFileSync(path)).update(String(statSync(path).mtimeMs)).digest('hex').slice(0, 16)
    } catch {
      return null
    }
  }
  return null
}

let cache: { mtimeMs: number; receipt: Receipt } | null = null

function readReceipt(): Receipt {
  const path = modelLoadReceiptPath()
  let mtimeMs: number
  try {
    mtimeMs = statSync(path).mtimeMs
  } catch {
    return {}
  }
  if (cache && cache.mtimeMs === mtimeMs) return cache.receipt
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Receipt
    cache = { mtimeMs, receipt: parsed && typeof parsed === 'object' ? parsed : {} }
  } catch {
    cache = { mtimeMs, receipt: {} }
  }
  return cache.receipt
}

function writeVerdict(model: string, verdict: ModelLoadVerdict): void {
  const path = modelLoadReceiptPath()
  const receipt = { ...readReceipt(), [model]: verdict }
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(receipt, null, 2))
  renameSync(tmp, path)
  cache = null
}

/** The current verdict for `model` — null when never probed for this engine, platform and download. */
export function modelLoadVerdict(model: string): ModelLoadVerdict | null {
  const verdict = readReceipt()[model]
  if (!verdict) return null
  if (verdict.engineVersion !== ANTFLY_PIN.version || verdict.platform !== platformKey()) return null
  if (verdict.download !== downloadFingerprint(model)) return null
  return verdict
}

/** False only when the engine is known to fail loading `model` here. */
export function modelLoadable(model: string): boolean {
  return modelLoadVerdict(model)?.loadable !== false
}

export type ProbeRunner = (binary: string, args: string[], timeoutMs: number) => Promise<{ code: number | null; output: string; timedOut: boolean }>

const runProbe: ProbeRunner = (binary, args, timeoutMs) => new Promise((resolve) => {
  const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  const keep = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-8_000) }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
  timer.unref?.()
  child.on('error', () => { clearTimeout(timer); resolve({ code: 127, output, timedOut }) })
  child.on('close', (code) => { clearTimeout(timer); resolve({ code, output, timedOut }) })
})

/** The engine's own words: the last diagnostic line, e.g. `startup failed … (error.MissingWeight)`. */
function failureReason(output: string): string {
  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean)
  const diagnostic = [...lines].reverse().find((l) => /error[.:]|failed/i.test(l))
  return (diagnostic ?? lines.at(-1) ?? 'the engine could not load it').slice(0, 300)
}

/**
 * Loads `model` with the engine once and records the verdict. Returns null
 * (nothing recorded) when there is nothing to probe or the probe hung.
 */
export async function probeModelLoad(binary: string, model: string, run: ProbeRunner = runProbe): Promise<ModelLoadVerdict | null> {
  const download = downloadFingerprint(model)
  if (!download) return null
  const result = await run(binary, ['inference', 'embed', modelDir(model), '--text', 'bakin model load probe'], MODEL_LOAD_PROBE_TIMEOUT_MS)
  if (result.timedOut) return null
  const verdict: ModelLoadVerdict = {
    loadable: result.code === 0,
    ...(result.code === 0 ? {} : { reason: failureReason(result.output) }),
    engineVersion: ANTFLY_PIN.version,
    platform: platformKey(),
    download,
    probedAt: new Date().toISOString(),
  }
  writeVerdict(model, verdict)
  return verdict
}

/** Probes every complete model that has no current verdict (the first boot after a pull or an engine bump). */
export async function ensureModelLoadVerdicts(models: readonly string[], binary: string | null, run: ProbeRunner = runProbe): Promise<void> {
  if (!binary || !existsSync(binary)) return
  for (const model of new Set(models)) {
    if (!modelStructurallyComplete(model).ok || modelLoadVerdict(model)) continue
    await probeModelLoad(binary, model, run)
  }
}

/** Tests: forget the in-memory receipt. */
export function _resetModelLoadCacheForTests(): void {
  cache = null
}
