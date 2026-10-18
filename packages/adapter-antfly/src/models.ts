import { spawn } from 'child_process'
import type { OperationPlan } from '@makinbakin/sdk/types'
import type { SearchAdapterSetupOptions } from '@bakin/core/adapters/search'
import type { AdapterLogger } from '@bakin/core/adapters/shared'
import type { AntflySettings } from './defaults'
import { modelDir, modelStructurallyComplete, unverifiedModelFiles } from './model-pins'
import { modelLoadVerdict, probeModelLoad } from './model-load'
import { inferenceModelsRoot } from './paths'
import { ANTFLY_PIN } from './pin'
import { createPullTracker, pullStagingDir } from './pull-progress'
import { findAntflyBinary } from './service'

/**
 * Search-model acquisition on antfly's v0.2 inference runtime.
 *
 * Models live at ~/.antfly/inference/models/{owner}/{name}/ and are pulled
 * from HuggingFace via `antfly inference pull`. Prefetching is strongly
 * recommended: at v0.2.0-rc.2 index-time embedding does NOT lazy-download a
 * missing model — the embeddings backfill fails (bakin#456). Recovery is
 * cheap though: once the model is on disk, ANY write to the table heals the
 * index (previously-failed docs get embedded too), so `bakin install
 * search-models` + `bakin reindex` fully repairs the affected tables.
 */

const noopLogger: AdapterLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

export interface InferenceModel {
  label: string
  model: string
  kind: 'embedder' | 'reranker'
}

export const REQUIRED_MODELS: InferenceModel[] = [
  { label: 'BGE text embedder', model: 'BAAI/bge-small-en-v1.5', kind: 'embedder' },
  // antfly's native multimodal CLIP — a built-in registry model that runs
  // in-process on Metal (GGUF), blessed by antfly's own e2e. Replaces the
  // Xenova ONNX mirror we used while openai/ shipped no ONNX (bakin#456).
  { label: 'CLIP visual embedder', model: 'antflydb/clipclap', kind: 'embedder' },
  { label: 'mxbai reranker', model: 'mixedbread-ai/mxbai-rerank-base-v1', kind: 'reranker' },
]

/**
 * The models actually REQUIRED for the live settings: every configured
 * in-process antfly embedder, plus the reranker ONLY when reranking is enabled.
 * Health/checks should use this rather than the static REQUIRED_MODELS so a
 * default install doesn't report "semantic indexing degraded" over a reranker
 * that is disabled by default.
 */
export function requiredModelsForSettings(settings: AntflySettings): InferenceModel[] {
  const out: InferenceModel[] = []
  const seen = new Set<string>()
  const add = (m: InferenceModel) => {
    if (m.model && !seen.has(m.model)) {
      seen.add(m.model)
      out.push(m)
    }
  }
  for (const [ref, embedder] of Object.entries(settings.embedders ?? {})) {
    if (embedder?.provider === 'antfly' && embedder.model) {
      add({ label: `${ref} embedder`, model: embedder.model, kind: 'embedder' })
    }
  }
  if (settings.search?.reranker?.enabled && settings.search.reranker.model) {
    add({ label: 'reranker', model: settings.search.reranker.model, kind: 'reranker' })
  }
  // Fall back to the static list if settings somehow declared no embedders.
  return out.length > 0 ? out : REQUIRED_MODELS.filter((m) => m.kind === 'embedder')
}

function modelPath(m: InferenceModel): string {
  return modelDir(m.model)
}

/** Structural completeness via the pinned distribution set (model-pins.ts):
 *  pinned models must carry their exact expected files — the old any-weight
 *  check passed a wrong-distribution download while the engine crash-looped
 *  on it (2026-07-21 field incident). */
function modelComplete(m: InferenceModel): { ok: true } | { ok: false; reason: string } {
  return modelStructurallyComplete(m.model)
}

interface MissingEntry {
  model: InferenceModel
  reason: string
}

function missingModelEntries(models: InferenceModel[]): MissingEntry[] {
  const out: MissingEntry[] = []
  for (const m of models) {
    const result = modelComplete(m)
    if (!result.ok) out.push({ model: m, reason: result.reason })
  }
  return out
}

function missingModels(models: InferenceModel[]): InferenceModel[] {
  return missingModelEntries(models).map((e) => e.model)
}

/**
 * Impact statement for a set of missing models, split by kind: a missing
 * embedder degrades semantic indexing/search, but a missing reranker only
 * disables reranking — saying "semantic indexing is degraded" for the latter
 * sends users chasing the wrong repair (bakin follow-up review, finding 6).
 */
export function describeMissingModels(missing: InferenceModel[]): { impact: string; remediation: string } {
  const embeddersMissing = missing.some((m) => m.kind === 'embedder')
  if (embeddersMissing) {
    return {
      impact: 'semantic indexing is degraded until they are (search itself keeps working)',
      remediation: 'Run `bakin install search-models`, then `bakin reindex` if content was indexed in the meantime.',
    }
  }
  return {
    impact: 'result reranking is unavailable until it is (indexing and search are unaffected)',
    remediation: 'Run `bakin install search-models`.',
  }
}

export async function checkInferenceModels(models: InferenceModel[]) {
  const missing = missingModelEntries(models)
  // Present but known not to load on this machine (#993): the engine boots
  // without it, so this is degraded, not broken — and says which leg.
  const unloadable = missing.length === 0
    ? models.flatMap((m) => {
      const verdict = modelLoadVerdict(m.model)
      return verdict && !verdict.loadable ? [{ model: m, reason: verdict.reason ?? 'the engine could not load it' }] : []
    })
    : []
  if (unloadable.length > 0) {
    const names = unloadable.map((u) => u.model.label).join(', ')
    return {
      name: 'models',
      status: 'warn' as const,
      message: `${names} can't load on this machine (engine ${ANTFLY_PIN.version}, ${process.platform}-${process.arch}) — the search that relies on ${unloadable.length === 1 ? 'it is' : 'them is'} unavailable here. Everything else is unaffected.`,
      remediation: 'Nothing to install: these files are complete, the engine just cannot run this model here. Point that embedder at a model that loads on this platform, or run Bakin on macOS for it.',
      details: {
        root: inferenceModelsRoot(),
        unloadable: unloadable.map((u) => ({ label: u.model.label, model: u.model.model, reason: u.reason })),
      },
    }
  }
  if (missing.length === 0) {
    // Structural verification only — pinned file NAMES and sizes, which is
    // what catches the wrong-distribution crash-loop class. sha256 hashing
    // lives on the INSTALL path (post-pull): checks run on doctor cadence
    // and hashing hundreds of MB per pass made a fully loaded test/CI
    // machine blow check timeouts (2026-07-22).
    return {
      name: 'models',
      status: 'ok' as const,
      message: `All ${models.length} search models present at ${inferenceModelsRoot()}`,
      details: { root: inferenceModelsRoot(), models: models.map((m) => m.model) },
    }
  }
  const { impact, remediation } = describeMissingModels(missing.map((e) => e.model))
  return {
    name: 'models',
    status: 'missing' as const,
    message: `${missing.length} of ${models.length} search model${missing.length === 1 ? '' : 's'} not downloaded - ${impact}`,
    remediation,
    details: {
      root: inferenceModelsRoot(),
      missing: missing.map((e) => ({
        label: e.model.label,
        model: e.model.model,
        path: modelPath(e.model),
        reason: e.reason,
      })),
    },
  }
}

/**
 * The model install as an operation (#895 D12). No point of no return: a pull
 * stages into a dot-dir and publishes with one atomic rename, and an
 * interrupted pull resumes at byte level, so cancel (SIGTERM) is allowed
 * throughout and keeps the staging dir for the next run.
 */
export const ANTFLY_MODELS_PLAN: OperationPlan = {
  stages: [
    // A progress line arrives every 16 MiB (~160s apart at 100 KB/s), and the
    // .part poll fills the gaps: the spec's model-pull override (30s/120s).
    { id: 'download', kind: 'downloading', label: 'Download search models', quiet: { quietMs: 30_000, stuckMs: 120_000 } },
    { id: 'verify', kind: 'verifying', label: 'Check the models are complete' },
  ],
  pointOfNoReturn: null,
}

/** A cancelled pull that ignores SIGTERM this long gets SIGKILL. */
const KILL_AFTER_MS = 10_000

/** How often the in-flight `.part` is read for bytes between the 16 MiB stderr lines. */
const PART_POLL_MS = 1_000

interface PullOptions {
  modelsDir: string
  signal: AbortSignal
  /** Each stderr line, as it arrives. */
  onLine: (line: string) => void
  pollMs?: number
  killAfterMs?: number
  /** Bytes so far, between lines as well as on them. */
  onBytes: (bytes: { received: number; total: number }) => void
}

/**
 * `antfly inference pull <model> --models-dir <root>`: the pull ignores
 * ANTFLY_HOME (T0 F1), so the flag keeps the pull and the completeness
 * check on one directory under every home. Abort sends SIGTERM.
 */
function runPull(antfly: string, model: string, opts: PullOptions): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(antfly, ['inference', 'pull', model, '--models-dir', opts.modelsDir], { stdio: ['ignore', 'ignore', 'pipe'] })
    const tracker = createPullTracker(pullStagingDir(opts.modelsDir, model))
    const tail: string[] = []
    let pending = ''
    let last = ''
    const report = () => {
      const bytes = tracker.snapshot()
      const key = `${bytes.received}/${bytes.total}`
      if (key === last) return
      last = key
      opts.onBytes(bytes)
    }
    const take = (line: string) => {
      if (!line.trim()) return
      tail.push(line.trim())
      if (tail.length > 20) tail.shift()
      opts.onLine(line)
      if (tracker.line(line)) report()
    }
    child.stderr?.on('data', (chunk: Buffer) => {
      const lines = (pending + chunk.toString()).split(/\r\n|\r|\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) take(line)
    })
    const poll = setInterval(report, opts.pollMs ?? PART_POLL_MS)
    // antfly honours SIGTERM (T0 F4); escalate if a future build does not,
    // so a cancelled pull can never hold search-engine forever.
    let escalate: ReturnType<typeof setTimeout> | undefined
    const abort = () => {
      child.kill('SIGTERM')
      escalate = setTimeout(() => child.kill('SIGKILL'), opts.killAfterMs ?? KILL_AFTER_MS)
    }
    if (opts.signal.aborted) abort()
    else opts.signal.addEventListener('abort', abort, { once: true })
    const settle = () => {
      clearInterval(poll)
      clearTimeout(escalate)
      opts.signal.removeEventListener('abort', abort)
    }
    child.on('error', (err) => {
      settle()
      reject(err)
    })
    child.on('close', (code) => {
      settle()
      take(pending)
      resolve({ code, stderr: tail.join('\n') })
    })
  })
}

export async function installInferenceModels(opts: SearchAdapterSetupOptions, logger: AdapterLogger = noopLogger, models: InferenceModel[], timings: { pollMs?: number; killAfterMs?: number } = {}) {
  const { op } = opts
  if (!op.holds('search-engine')) throw new Error('installInferenceModels requires search-engine (run it inside an operation that declares it)')
  const start = Date.now()
  const skipAll = (reason: string) => {
    for (const stage of ANTFLY_MODELS_PLAN.stages) op.skip(stage.id, reason)
  }

  const antfly = findAntflyBinary()
  if (!antfly) {
    return {
      name: 'models',
      status: 'failed' as const,
      message: 'antfly binary not found - search models cannot be pulled until Antfly is installed.',
      durationMs: Date.now() - start,
    }
  }

  const missing = missingModels(models)
  if (missing.length === 0) {
    skipAll('already downloaded')
    return {
      name: 'models',
      status: 'noop' as const,
      message: `All ${models.length} search models already present.`,
      durationMs: Date.now() - start,
    }
  }

  if (!opts.autoApprove) {
    skipAll('not approved')
    return {
      name: 'models',
      status: 'skipped' as const,
      message: 'Model download not approved; semantic indexing is degraded until `bakin install search-models` runs (follow with `bakin reindex` to repair anything indexed meanwhile).',
      durationMs: Date.now() - start,
    }
  }

  const failed = (message: string, error?: unknown) => {
    // A cancel accepted before the failure settles cancelled, not failed.
    op.throwIfCancelled()
    return { name: 'models', status: 'failed' as const, message, ...(error === undefined ? {} : { error }), durationMs: Date.now() - start }
  }
  const modelsDir = inferenceModelsRoot()
  logger.info('Pulling search models', { count: missing.length, antfly, modelsDir })
  op.stage('download')
  for (const m of missing) op.item('download', { id: m.model, label: m.label })
  for (const m of missing) {
    logger.info('Pulling model', { model: m.model, label: m.label })
    op.item('download', { id: m.model, label: m.label, status: 'active' })
    let result: { code: number | null; stderr: string }
    try {
      result = await runPull(antfly, m.model, {
        modelsDir,
        signal: op.signal,
        pollMs: timings.pollMs,
        killAfterMs: timings.killAfterMs,
        onLine: (line) => op.output(line),
        onBytes: (bytes) => op.bytes('download', bytes, m.model),
      })
    } catch (err) {
      logger.error('Failed to spawn antfly inference pull', err)
      op.item('download', { id: m.model, label: m.label, status: 'failed' })
      return failed(`Failed to pull ${m.model}: ${err instanceof Error ? err.message : String(err)}`, err)
    }
    // Cancelled: the staging dir stays, so the next pull resumes (T0 F4/F6).
    op.throwIfCancelled()
    if (result.code !== 0) {
      op.item('download', { id: m.model, label: m.label, status: 'failed', message: `exited with code ${result.code}` })
      return failed(`antfly inference pull ${m.model} exited with code ${result.code}${result.stderr ? `: ${result.stderr}` : ''}`)
    }
    op.item('download', { id: m.model, label: m.label, status: 'done' })
  }

  op.stage('verify')
  const unloadable: InferenceModel[] = []
  for (const m of missing) {
    const verified = modelComplete(m)
    if (!verified.ok) return failed(`antfly inference pull ${m.model} reported success but ${verified.reason}`)
    // Complete is not the same as loadable here (#993): ask the engine now,
    // so the next start leaves an unloadable model off its preloads.
    op.throwIfCancelled()
    const verdict = await probeModelLoad(antfly, m.model, { signal: op.signal })
    if (verdict && !verdict.loadable) {
      unloadable.push(m)
      op.log(`${m.label} can't load on this machine: ${verdict.reason ?? 'the engine could not load it'}`, 'warn')
    }
    const drifted = await unverifiedModelFiles(m.model)
    if (drifted.length > 0) {
      logger.warn('Pulled model differs from the pinned verified distribution', { model: m.model, files: drifted })
      op.log(`${m.model}: differs from the pinned distribution (${drifted.join(', ')})`, 'warn')
    }
  }

  const pulledLabels = missing.map((m) => m.label)
  const durationMs = Date.now() - start
  logger.info('Search models installed', { pulled: pulledLabels, unloadable: unloadable.map((m) => m.model), durationMs })
  const unloadableNote = unloadable.length > 0
    ? ` ${unloadable.map((m) => m.label).join(', ')} can't load on this machine — the search that relies on ${unloadable.length === 1 ? 'it' : 'them'} is unavailable here; everything else works.`
    : ''
  return {
    name: 'models',
    status: 'installed' as const,
    message: `Pulled ${pulledLabels.length} model${pulledLabels.length === 1 ? '' : 's'}: ${pulledLabels.join(', ')}.${unloadableNote}`,
    durationMs,
  }
}

export const _modelsInternals = {
  missingModels,
  missingModelEntries,
  modelPath,
  modelComplete,
  runPull,
}
