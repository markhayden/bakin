import { spawn } from 'child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'fs'
import { basename, dirname, join } from 'path'
import type { OperationPlan } from '@makinbakin/sdk/types'
import type { SearchAdapterModelCheck, SearchAdapterSetupCheckOptions, SearchAdapterSetupOptions } from '@bakin/core/adapters/search'
import type { AdapterLogger } from '@bakin/core/adapters/shared'
import type { AntflySettings } from './defaults'
import { MODEL_PINS, MODEL_PULL_VARIANTS, isPinnedModel, isSafeModelName, modelDir, modelStructurallyComplete, modelVariantMismatch, pinMismatches, pulledVariantDir } from './model-pins'
import { modelLoadVerdict, probeModelLoad } from './model-load'
import { directoryFacts, identityOf } from './identity'
import { inferenceModelsRoot } from './paths'
import { ANTFLY_PIN } from './pin'
import { acquireModelsLock, createPullTracker, pullStagingDir, pullStagingRoot, variantPullStagingDir } from './pull-progress'
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

/** The pinned requirement's identity: the pin set + the pull variant — what a pin bump changes without any file moving (R5′). */
function requiredModelIdentity(model: string): string {
  return identityOf({ model, pins: MODEL_PINS[model] ?? null, variant: MODEL_PULL_VARIANTS[model] ?? null })
}

/**
 * The installed model's STRUCTURAL identity (R5″): every file's name, size
 * and mtime under the model dir (two levels), the manifest, the recorded
 * variant and the cached load verdict — hashed together, never contents.
 * Undefined when nothing of the model is on disk.
 */
function installedModelIdentity(model: string): { identity: string } | undefined {
  const dir = modelDir(model)
  if (!existsSync(dir)) return undefined
  const verdict = modelLoadVerdict(model)
  return {
    identity: identityOf({
      files: directoryFacts(dir),
      variantMismatch: modelVariantMismatch(model),
      verdict: verdict ? { loadable: verdict.loadable, reason: verdict.reason ?? null, probedAt: verdict.probedAt } : null,
    }),
  }
}

export async function checkInferenceModels(models: InferenceModel[], opts: SearchAdapterSetupCheckOptions = {}) {
  if (opts.signal?.aborted) throw opts.signal.reason instanceof Error ? opts.signal.reason : new Error('models check aborted')
  const unsafe = models.filter((m) => !isSafeModelName(m.model))
  if (unsafe.length > 0) {
    return {
      name: 'models',
      status: 'missing' as const,
      message: `Invalid search model id${unsafe.length === 1 ? '' : 's'} ${unsafe.map((m) => `"${m.model}"`).join(', ')} — expected owner/name`,
      remediation: 'Fix the search model ids in the search settings.',
      details: { root: inferenceModelsRoot(), invalid: unsafe.map((m) => m.model) },
      applicable: true,
      models: models.map((m): SearchAdapterModelCheck => (isSafeModelName(m.model)
        ? { id: m.model, label: m.label, required: { identity: requiredModelIdentity(m.model) }, state: 'unsupported', remediation: 'change-config', reason: 'not judged — another configured model id is invalid' }
        : { id: m.model, label: m.label, required: { identity: identityOf({ invalid: m.model }) }, state: 'unsupported', remediation: 'change-config', reason: 'invalid model id — expected owner/name' })),
    }
  }
  // Three independent findings, so none hides another (a missing reranker
  // must not mask an embedder that can't load):
  // - missing: not downloaded (or incomplete) — the install fetches it;
  // - stale: complete but not the pinned variant — the install re-pulls it
  //   (an `ok` here once meant `bakin install search-models` asked nothing
  //   and its unapproved install skipped);
  // - unloadable: the engine itself failed to load it here (#993) — degraded
  //   and named. Stale → the re-pull fixes it. Pinned → the install
  //   hash-checks its files (#1006) and re-pulls damaged ones, which this
  //   structural check cannot see, so it says "may". Custom → nothing to
  //   install.
  const missing = missingModelEntries(models)
  const present = models.filter((m) => !missing.some((e) => e.model === m))
  const stale = present.flatMap((m) => {
    const why = modelVariantMismatch(m.model)
    return why ? [{ model: m, why }] : []
  })
  const unloadable = present.flatMap((m) => {
    const verdict = modelLoadVerdict(m.model)
    return verdict && !verdict.loadable ? [{ model: m, reason: verdict.reason ?? 'the engine could not load it' }] : []
  })
  const isStale = (model: InferenceModel) => stale.some((s) => s.model === model)
  const staleUnloadable = unloadable.filter((u) => isStale(u.model))
  const maybeDamaged = unloadable.filter((u) => !isStale(u.model) && isPinnedModel(u.model.model))
  const unfixable = unloadable.filter((u) => !isStale(u.model) && !isPinnedModel(u.model.model))
  const machine = `engine ${ANTFLY_PIN.version}, ${process.platform}-${process.arch}`
  const labels = (list: Array<{ model: InferenceModel }>) => list.map((x) => x.model.label).join(', ')
  const verb = (list: unknown[], one: string, many: string) => (list.length === 1 ? one : many)
  const root = inferenceModelsRoot()

  // The per-model verdicts core reads structurally (D7.9): the same three
  // findings as the prose below, classified once here.
  const rows: SearchAdapterModelCheck[] = models.map((m) => {
    const base = { id: m.model, label: m.label, required: { identity: requiredModelIdentity(m.model) }, installed: installedModelIdentity(m.model) }
    const missingEntry = missing.find((e) => e.model === m)
    if (missingEntry) return { ...base, state: 'missing', remediation: 'install', reason: missingEntry.reason }
    const staleEntry = stale.find((s) => s.model === m)
    const unloadableEntry = unloadable.find((u) => u.model === m)
    if (staleEntry) return { ...base, state: unloadableEntry ? 'unloadable' : 'variant-mismatch', remediation: 'replace-variant', reason: unloadableEntry ? `${staleEntry.why}; ${unloadableEntry.reason}` : staleEntry.why }
    if (unloadableEntry) {
      return isPinnedModel(m.model)
        ? { ...base, state: 'unloadable', remediation: 'install', reason: unloadableEntry.reason }
        : { ...base, state: 'unsupported', remediation: 'change-config', reason: unloadableEntry.reason }
    }
    return { ...base, state: 'ok' }
  })

  if (missing.length === 0 && stale.length === 0 && unloadable.length === 0) {
    // Structural verification only — pinned file NAMES and sizes, which is
    // what catches the wrong-distribution crash-loop class. sha256 hashing
    // lives on the INSTALL path (skip check + staged verify): checks run on
    // doctor cadence and hashing hundreds of MB per pass made a fully loaded
    // test/CI machine blow check timeouts (2026-07-22). The message says
    // exactly what was checked — never "verified" (#898 E).
    return {
      name: 'models',
      status: 'ok' as const,
      message: models.every((m) => isPinnedModel(m.model))
        ? `All ${models.length} search models present at ${root} (files present — integrity is hash-checked at install/repair)`
        : `All ${models.length} search models present at ${root} (files present — pinned models are hash-checked at install/repair; custom models are checked structurally only)`,
      details: { root, models: models.map((m) => m.model) },
      applicable: true,
      models: rows,
    }
  }

  const missingImpact = missing.length > 0 ? describeMissingModels(missing.map((e) => e.model)) : null
  const message = [
    ...(missingImpact ? [`${missing.length} of ${models.length} search model${missing.length === 1 ? '' : 's'} not downloaded - ${missingImpact.impact}.`] : []),
    ...(stale.length > 0 ? [`${labels(stale)} ${verb(stale, 'is', 'are')} not the pinned download (${stale.map((s) => s.why).join('; ')}).`] : []),
    ...(staleUnloadable.length > 0 ? [`${labels(staleUnloadable)} can't load on this machine (${machine}) until re-downloaded.`] : []),
    ...(stale.length > 0 && staleUnloadable.length === 0 && missing.length === 0 ? ['Search still works here.'] : []),
    ...(maybeDamaged.length > 0
      ? [`${labels(maybeDamaged)} can't load on this machine (${machine}) — if ${verb(maybeDamaged, 'its', 'their')} files are damaged, \`bakin install search-models\` re-downloads them (it hash-checks pinned files).`]
      : []),
    ...(unfixable.length > 0
      ? [missing.length > 0 || stale.length > 0 || maybeDamaged.length > 0
        ? `${labels(unfixable)} can't load on this machine either (${machine}), and installing won't change that.`
        : `${labels(unfixable)} can't load on this machine (${machine}) — the search that relies on ${verb(unfixable, 'it is', 'them is')} unavailable here. Everything else is unaffected.`]
      : []),
  ].join(' ')
  const details = {
    root,
    ...(missing.length > 0 ? { missing: missing.map((e) => ({ label: e.model.label, model: e.model.model, path: modelPath(e.model), reason: e.reason })) } : {}),
    ...(stale.length > 0 ? { stale: stale.map((s) => ({ label: s.model.label, model: s.model.model, reason: s.why })) } : {}),
    ...(unloadable.length > 0 ? { unloadable: unloadable.map((u) => ({ label: u.model.label, model: u.model.model, reason: u.reason })) } : {}),
  }
  // `missing` / `broken` = install work (onboarding installs, the wizard
  // asks); `warn` = only can't-load, where an install at most re-checks.
  if (missingImpact) {
    return { name: 'models', status: 'missing' as const, message, remediation: missingImpact.remediation, details, applicable: true, models: rows }
  }
  if (stale.length > 0) {
    return {
      name: 'models',
      status: 'broken' as const,
      message,
      remediation: 'Run `bakin install search-models`: it re-downloads the model in the pinned form and replaces the old install.',
      details,
      applicable: true,
      models: rows,
    }
  }
  return {
    name: 'models',
    status: 'warn' as const,
    message,
    remediation: maybeDamaged.length > 0
      ? 'Run `bakin install search-models`: it hash-checks the pinned files and re-downloads damaged ones. If they are intact, the engine cannot run this model here — point that embedder at a model that loads on this platform.'
      : 'Nothing to install: these files are complete, the engine just cannot run this model here. Point that embedder at a model that loads on this platform, or run Bakin on macOS for it.',
    details,
    applicable: true,
    models: rows,
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
  const variant = MODEL_PULL_VARIANTS[model]
  return new Promise((resolve, reject) => {
    const child = spawn(antfly, ['inference', 'pull', variant ? `${model}:${variant}` : model, '--models-dir', opts.modelsDir], { stdio: ['ignore', 'ignore', 'pipe'] })
    const tracker = createPullTracker(variant ? () => variantPullStagingDir(opts.modelsDir, model) : pullStagingDir(opts.modelsDir, model))
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

/** The ONE recoverable copy of an install being replaced (one replacement at a time: search-engine). */
const backupFor = (target: string) => join(dirname(target), `.bakin-replacing-${basename(target)}`)
/** Retired copies — never read, only deleted (a half-deleted dir lives only here). */
const trashPrefixFor = (target: string) => `.bakin-trash-${basename(target)}-`

function retire(dir: string, target: string): string {
  const trash = join(dirname(target), `${trashPrefixFor(target)}${process.pid}-${Date.now()}`)
  renameSync(dir, trash)
  return trash
}

function sweepTrash(model: string, target: string, logger: AdapterLogger): void {
  const parent = dirname(target)
  if (!existsSync(parent)) return
  for (const entry of readdirSync(parent)) {
    if (!entry.startsWith(trashPrefixFor(target))) continue
    try {
      rmSync(join(parent, entry), { recursive: true, force: true })
    } catch (err) {
      logger.warn('Could not delete a replaced model install', { model, dir: join(parent, entry), error: err instanceof Error ? err.message : String(err) })
    }
  }
}

/**
 * Finishes an interrupted replacement (runs under search-engine, before any
 * check or pull). The backup's fixed name is the journal: a backup with no
 * model dir means a crash between the two renames — it goes back; a backup
 * next to the model dir means the replacement committed — it is retired to
 * trash whole. Then trash is swept.
 */
function recoverModelInstall(model: string, logger: AdapterLogger): void {
  const target = modelDir(model)
  const backup = backupFor(target)
  if (existsSync(backup)) {
    if (existsSync(target)) {
      retire(backup, target)
    } else {
      logger.warn('Restoring a model install an interrupted replacement left aside', { model, from: backup })
      renameSync(backup, target)
    }
  }
  sweepTrash(model, target, logger)
}

/** A staged copy that may be published as-is: complete, the pinned variant, every pinned file matching its sha256. */
async function stagedModelVerifies(model: string, stagingRoot: string): Promise<boolean> {
  if (!existsSync(modelDir(model, stagingRoot))) return false
  if (!modelStructurallyComplete(model, stagingRoot).ok) return false
  if (modelVariantMismatch(model, stagingRoot) !== null) return false
  return (await pinMismatches(model, stagingRoot)).length === 0
}

/**
 * In the STAGING root: moves a variant pull's `<name>--antfly-<hash>`
 * install to the model's own directory name there, so it can be verified
 * exactly where it will be published from.
 */
function adoptStagedVariant(model: string, variant: string, stagingRoot: string): string | null {
  const target = modelDir(model, stagingRoot)
  const pulled = pulledVariantDir(stagingRoot, model, variant)
  if (!pulled) return `no ${variant} install appeared in staging next to ${target}`
  rmSync(target, { recursive: true, force: true })
  try {
    renameSync(pulled, target)
  } catch (err) {
    return `could not move ${pulled} into place in staging: ${err instanceof Error ? err.message : String(err)}`
  }
  return null
}

/**
 * Publishes a staged, VERIFIED model into the live tree with the replacement
 * protocol `recoverModelInstall` finishes after a crash (#993): old install →
 * backup, staged → model dir (backup restored if that fails), backup →
 * trash, sweep.
 */
function publishStagedModel(model: string, stagingRoot: string, logger: AdapterLogger): string | null {
  const target = modelDir(model)
  recoverModelInstall(model, logger)
  mkdirSync(dirname(target), { recursive: true })
  const backup = existsSync(target) ? backupFor(target) : null
  if (backup) renameSync(target, backup)
  try {
    renameSync(modelDir(model, stagingRoot), target)
  } catch (err) {
    if (backup) renameSync(backup, target)
    return `could not publish ${model}: ${err instanceof Error ? err.message : String(err)}`
  }
  if (backup) retire(backup, target)
  sweepTrash(model, target, logger)
  return null
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

  // Every path below is built from model ids — custom ones come from
  // settings: an id that is not exactly owner/name never reaches the
  // filesystem (#898 E).
  const unsafe = models.filter((m) => !isSafeModelName(m.model))
  if (unsafe.length > 0) {
    skipAll('invalid model id')
    return {
      name: 'models',
      status: 'failed' as const,
      message: `Invalid search model id${unsafe.length === 1 ? '' : 's'} ${unsafe.map((m) => `"${m.model}"`).join(', ')} — expected owner/name; fix the search settings.`,
      durationMs: Date.now() - start,
    }
  }

  const liveRoot = inferenceModelsRoot()
  const stagingRoot = pullStagingRoot(liveRoot)
  // The models root is shared by every Bakin home on this machine: the whole
  // check → pull → verify → publish runs under ONE machine-wide lock
  // (#898 E) — installed state is only ever judged while holding it.
  const lock = acquireModelsLock(liveRoot)
  if ('heldBy' in lock) {
    skipAll('another install holds the models lock')
    return {
      name: 'models',
      status: 'failed' as const,
      message: `Another Bakin on this machine is installing search models${lock.heldBy > 0 ? ` (pid ${lock.heldBy})` : ''} — try again when it finishes. If none is (an install crashed), remove ${lock.path}.`,
      durationMs: Date.now() - start,
    }
  }
  try {
    // Every model publishes through the replacement protocol, so a crash
    // between its renames is finished for EVERY requested model first.
    for (const m of models) recoverModelInstall(m.model, logger)
    // The install skip HASHES (#898 E): a model is present only when it is
    // structurally complete, the pinned variant (#993), AND every pinned file
    // matches its sha256 — never trusted on names and sizes alone. Custom
    // (unpinned) models can only be checked structurally; messages say so.
    const missing: InferenceModel[] = []
    for (const m of models) {
      if (!modelComplete(m).ok || modelVariantMismatch(m.model) !== null || (await pinMismatches(m.model)).length > 0) missing.push(m)
    }
    if (missing.length === 0) {
      skipAll('already downloaded')
      const custom = models.filter((m) => !isPinnedModel(m.model)).length
      return {
        name: 'models',
        status: 'noop' as const,
        message: custom === 0
          ? `All ${models.length} search models already present and matching their pins.`
          : `All ${models.length} search models already present (${models.length - custom} matching their pins; ${custom} custom, checked structurally).`,
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
    // Every pull lands in a STAGING models root beside the live tree and is
    // verified there; the live tree the running engine reads is touched only
    // to publish models that passed, after every pull verified. A failure or
    // cancel leaves every live model exactly as it was, and the staging root
    // keeps antfly's resumable staging for the next run (T0 F6).
    logger.info('Pulling search models', { count: missing.length, antfly, stagingRoot })
    op.stage('download')
    for (const m of missing) op.item('download', { id: m.model, label: m.label })
    for (const m of missing) {
      // A copy a previous run already downloaded into staging is REUSED when
      // it still verifies (structure, pinned variant, pin hashes) — a failed
      // or cancelled later model never costs a re-download of this one. A
      // copy that does not verify is discarded and pulled fresh.
      if (await stagedModelVerifies(m.model, stagingRoot)) {
        logger.info('Reusing a verified staged model', { model: m.model })
        op.item('download', { id: m.model, label: m.label, status: 'skipped', message: 'already downloaded and verified' })
        continue
      }
      rmSync(modelDir(m.model, stagingRoot), { recursive: true, force: true })
      logger.info('Pulling model', { model: m.model, label: m.label })
      op.item('download', { id: m.model, label: m.label, status: 'active' })
      let result: { code: number | null; stderr: string }
      try {
        result = await runPull(antfly, m.model, {
          modelsDir: stagingRoot,
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
      // Cancelled: antfly's staging dir stays, so the next pull resumes (T0 F4/F6).
      op.throwIfCancelled()
      if (result.code !== 0) {
        op.item('download', { id: m.model, label: m.label, status: 'failed', message: `exited with code ${result.code}` })
        return failed(`antfly inference pull ${m.model} exited with code ${result.code}${result.stderr ? `: ${result.stderr}` : ''}`)
      }
      const variant = MODEL_PULL_VARIANTS[m.model]
      const adoptError = variant ? adoptStagedVariant(m.model, variant, stagingRoot) : null
      if (adoptError) {
        op.item('download', { id: m.model, label: m.label, status: 'failed', message: adoptError })
        return failed(`antfly inference pull ${m.model}:${variant} reported success but ${adoptError}`)
      }
      op.item('download', { id: m.model, label: m.label, status: 'done' })
    }

    op.stage('verify')
    for (const m of missing) {
      const verified = modelStructurallyComplete(m.model, stagingRoot)
      if (!verified.ok) {
        rmSync(modelDir(m.model, stagingRoot), { recursive: true, force: true })
        return failed(`antfly inference pull ${m.model} reported success but ${verified.reason}`)
      }
      // A pulled file that does not match its pin FAILS the install (#898 E):
      // the engine must never boot on an unverified distribution.
      const drifted = await pinMismatches(m.model, stagingRoot)
      if (drifted.length > 0) {
        logger.error('Pulled model does not match its pins', { model: m.model, files: drifted })
        rmSync(modelDir(m.model, stagingRoot), { recursive: true, force: true })
        return failed(`antfly inference pull ${m.model} downloaded files that do not match their pinned sha256 (${drifted.join(', ')}) — the distribution differs from the verified one`)
      }
    }
    // Last cancel point: nothing live has been touched yet.
    op.throwIfCancelled()

    // Publish every verified model into the live tree.
    for (const m of missing) {
      const publishError = publishStagedModel(m.model, stagingRoot, logger)
      if (publishError) return failed(publishError)
    }

    // Complete is not the same as loadable (#993): ask the engine about the
    // PUBLISHED files, so the next start leaves an unloadable model off its
    // preloads.
    const unloadable: InferenceModel[] = []
    for (const m of missing) {
      op.throwIfCancelled()
      const verdict = await probeModelLoad(antfly, m.model, { signal: op.signal })
      if (verdict && !verdict.loadable) {
        unloadable.push(m)
        op.log(`${m.label} can't load on this machine: ${verdict.reason ?? 'the engine could not load it'}`, 'warn')
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
  } finally {
    lock.release()
  }
}

export const _modelsInternals = {
  missingModels,
  missingModelEntries,
  modelPath,
  modelComplete,
  runPull,
}
