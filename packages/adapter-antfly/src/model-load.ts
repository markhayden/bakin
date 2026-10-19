/**
 * Whether a model actually LOADS on this machine's pinned engine (#993).
 *
 * A complete, pin-verified download can still fail to load: clipclap's
 * default distribution (GGUFs + an ONNX set) failed on the static Linux
 * engine with error.MissingWeight while macOS Metal loaded it — fixed by
 * pulling the GGUF variant (`MODEL_PULL_VARIANTS`). The engine EXITS when a
 * preloaded model fails to warm, so one unloadable model took every search
 * leg down with it; this probe is the net for the next one.
 *
 * The engine itself is the only authority: `antfly inference embed <dir>`
 * loads the model the way the server would. Verdicts:
 * - are recorded per model (`~/.antfly/bakin-model-load/<model>.json`, each
 *   replaced atomically — homes sharing the models never clobber each other);
 * - are keyed by the VERIFIED engine version (the binary must report the
 *   pin — a probe of another version records nothing), the platform and the
 *   download, so a repin or a re-pull re-probes;
 * - say "can't load" only when the engine itself says so (an `error.X`
 *   diagnostic and a nonzero exit). A spawn failure, a signal, a timeout or
 *   a cancel records nothing — unknown, which means loadable, exactly the
 *   behavior before probes existed;
 * - apply only to the engine Bakin manages (a guest endpoint loads models
 *   on someone else's machine).
 */
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { antflyHome, isLocalDefaultUrl } from './paths'
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

export const MODEL_LOAD_PROBE_TIMEOUT_MS = 120_000
const VERSION_TIMEOUT_MS = 15_000

export function modelLoadReceiptDir(): string {
  return join(antflyHome(), 'bakin-model-load')
}

function receiptPath(model: string): string {
  return join(modelLoadReceiptDir(), `${model.replace(/[^A-Za-z0-9._-]/g, '__')}.json`)
}

function platformKey(): string {
  return `${process.platform}-${process.arch}`
}

/** What the pull wrote last: a re-pull rewrites it, so the verdict follows the files. */
function downloadFingerprint(model: string): string | null {
  const root = modelDir(model)
  for (const marker of ['.antfly-download-complete.json', 'model_manifest.json']) {
    const path = join(root, marker)
    if (!existsSync(path)) continue
    try {
      return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)
    } catch {
      return null
    }
  }
  return null
}

const cache = new Map<string, { mtimeMs: number; verdict: ModelLoadVerdict | null }>()

function readVerdict(model: string): ModelLoadVerdict | null {
  const path = receiptPath(model)
  let mtimeMs: number
  try {
    mtimeMs = statSync(path).mtimeMs
  } catch {
    return null
  }
  const cached = cache.get(path)
  if (cached && cached.mtimeMs === mtimeMs) return cached.verdict
  let verdict: ModelLoadVerdict | null = null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ModelLoadVerdict
    verdict = parsed && typeof parsed.loadable === 'boolean' ? parsed : null
  } catch {
    verdict = null
  }
  cache.set(path, { mtimeMs, verdict })
  return verdict
}

function writeVerdict(model: string, verdict: ModelLoadVerdict): void {
  const path = receiptPath(model)
  mkdirSync(modelLoadReceiptDir(), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(verdict, null, 2))
  renameSync(tmp, path)
  cache.delete(path)
}

/** The current verdict for `model` — null when never probed for this engine, platform and download. */
export function modelLoadVerdict(model: string): ModelLoadVerdict | null {
  const verdict = readVerdict(model)
  if (!verdict) return null
  if (verdict.engineVersion !== ANTFLY_PIN.version || verdict.platform !== platformKey()) return null
  if (verdict.download !== downloadFingerprint(model)) return null
  return verdict
}

/**
 * False only when the engine Bakin manages is known to fail loading `model`
 * here. A guest endpoint (`engineUrl` not the managed one) is never judged
 * by this machine's verdicts.
 */
export function modelLoadable(model: string, engineUrl: string): boolean {
  if (!isLocalDefaultUrl(engineUrl)) return true
  return modelLoadVerdict(model)?.loadable !== false
}

export interface ProbeResult {
  code: number | null
  output: string
  timedOut: boolean
  /** The process could not be started at all (missing or non-executable binary). */
  spawnFailed: boolean
  aborted: boolean
}

export type ProbeRunner = (binary: string, args: string[], timeoutMs: number, signal?: AbortSignal) => Promise<ProbeResult>

const runProbe: ProbeRunner = (binary, args, timeoutMs, signal) => new Promise((resolve) => {
  const result: ProbeResult = { code: null, output: '', timedOut: false, spawnFailed: false, aborted: false }
  if (signal?.aborted) return resolve({ ...result, aborted: true })
  const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const keep = (chunk: Buffer) => { result.output = (result.output + chunk.toString()).slice(-8_000) }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  const stop = () => { child.kill('SIGKILL') }
  const timer = setTimeout(() => { result.timedOut = true; stop() }, timeoutMs)
  timer.unref?.()
  const onAbort = () => { result.aborted = true; stop() }
  signal?.addEventListener('abort', onAbort, { once: true })
  const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort) }
  child.on('error', () => { done(); resolve({ ...result, spawnFailed: true }) })
  child.on('close', (code) => { done(); resolve({ ...result, code }) })
})

/** The engine's own diagnostic: e.g. `startup failed … (error.MissingWeight)`. */
const ENGINE_ERROR_RE = /\berror\.[A-Za-z]+\b/

function failureReason(output: string): string {
  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean)
  const diagnostic = [...lines].reverse().find((l) => ENGINE_ERROR_RE.test(l))
  return (diagnostic ?? lines.at(-1) ?? 'the engine could not load it').slice(0, 300)
}

/** The version the binary reports — the verdict's identity, never assumed from the pin. */
async function engineVersion(binary: string, run: ProbeRunner, signal?: AbortSignal): Promise<string | null> {
  const result = await run(binary, ['--version'], VERSION_TIMEOUT_MS, signal)
  if (result.code !== 0) return null
  return result.output.match(/\d+\.\d+\.\d+[-.\w]*/)?.[0] ?? null
}

/**
 * Loads `model` with the engine once and records the verdict. Returns null —
 * recording nothing — when there is nothing to probe, the binary isn't the
 * pinned engine, or the probe couldn't run to an answer (spawn failure,
 * signal, timeout, cancel).
 */
export async function probeModelLoad(binary: string, model: string, opts: { run?: ProbeRunner; signal?: AbortSignal } = {}): Promise<ModelLoadVerdict | null> {
  const run = opts.run ?? runProbe
  const download = downloadFingerprint(model)
  if (!download) return null
  if (await engineVersion(binary, run, opts.signal) !== ANTFLY_PIN.version) return null
  const result = await run(binary, ['inference', 'embed', modelDir(model), '--text', 'bakin model load probe'], MODEL_LOAD_PROBE_TIMEOUT_MS, opts.signal)
  if (result.spawnFailed || result.timedOut || result.aborted || result.code === null) return null
  const rejected = result.code !== 0 && ENGINE_ERROR_RE.test(result.output)
  if (result.code !== 0 && !rejected) return null
  const verdict: ModelLoadVerdict = {
    loadable: result.code === 0,
    ...(rejected ? { reason: failureReason(result.output) } : {}),
    engineVersion: ANTFLY_PIN.version,
    platform: platformKey(),
    download,
    probedAt: new Date().toISOString(),
  }
  writeVerdict(model, verdict)
  return verdict
}

/** Probes every complete model that has no current verdict (the first start after a pull or an engine bump). */
export async function ensureModelLoadVerdicts(models: readonly string[], binary: string | null, opts: { run?: ProbeRunner; signal?: AbortSignal } = {}): Promise<void> {
  if (!binary || !existsSync(binary)) return
  for (const model of new Set(models)) {
    if (opts.signal?.aborted) return
    if (!modelStructurallyComplete(model).ok || modelLoadVerdict(model)) continue
    await probeModelLoad(binary, model, opts)
  }
}

/** Tests: forget the in-memory receipts. */
export function _resetModelLoadCacheForTests(): void {
  cache.clear()
}
