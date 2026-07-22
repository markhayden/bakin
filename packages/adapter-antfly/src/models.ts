import { spawn } from 'child_process'
import type { SearchAdapterSetupOptions } from '@bakin/core/adapters/search'
import type { AdapterLogger } from '@bakin/core/adapters/shared'
import type { AntflySettings } from './defaults'
import { modelDir, modelStructurallyComplete, unverifiedModelFiles } from './model-pins'
import { inferenceModelsRoot } from './paths'
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
  if (missing.length === 0) {
    // Presence passed — also verify pinned hashes. Drift is reported but
    // never blocks: it means "differs from the verified distribution", not
    // the crash-loop class a missing pinned file signals.
    const unverified: Array<{ model: string; files: string[] }> = []
    for (const m of models) {
      const files = await unverifiedModelFiles(m.model)
      if (files.length > 0) unverified.push({ model: m.model, files })
    }
    const driftNote = unverified.length > 0
      ? ` (${unverified.length} model${unverified.length === 1 ? '' : 's'} differ from the pinned verified distribution — see details)`
      : ''
    return {
      name: 'models',
      status: 'ok' as const,
      message: `All ${models.length} search models present at ${inferenceModelsRoot()}${driftNote}`,
      details: {
        root: inferenceModelsRoot(),
        models: models.map((m) => m.model),
        ...(unverified.length > 0 ? { unverified } : {}),
      },
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

function runPull(
  antfly: string,
  model: string,
  interactive: boolean
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(antfly, ['inference', 'pull', model], {
      stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    if (!interactive) {
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString()
      })
    }
    child.on('error', (err) => reject(err))
    child.on('close', (code) => resolve({ code, stderr }))
  })
}

export async function installInferenceModels(opts: SearchAdapterSetupOptions, logger: AdapterLogger = noopLogger, models: InferenceModel[]) {
  const start = Date.now()

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
    return {
      name: 'models',
      status: 'noop' as const,
      message: `All ${models.length} search models already present.`,
      durationMs: Date.now() - start,
    }
  }

  if (opts.interactive && !opts.autoApprove) {
    const proceed = await opts.askYesNo?.(
      `Download ${missing.length} search model${missing.length === 1 ? '' : 's'} (~1GB total) from HuggingFace to ${inferenceModelsRoot()}? (Recommended - semantic indexing is degraded without them.)`,
      true
    )
    if (!proceed) {
      return {
        name: 'models',
        status: 'skipped' as const,
        message: 'User declined model download; semantic indexing is degraded until `bakin install search-models` runs (follow with `bakin reindex` to repair anything indexed meanwhile).',
        durationMs: Date.now() - start,
      }
    }
  } else if (!opts.autoApprove) {
    return {
      name: 'models',
      status: 'skipped' as const,
      message: 'Non-interactive run without --yes; skipping model download. Semantic indexing is degraded until `bakin install search-models` runs (follow with `bakin reindex` to repair anything indexed meanwhile).',
      durationMs: Date.now() - start,
    }
  }

  logger.info('Pulling search models', { count: missing.length, antfly })
  const pulledLabels: string[] = []
  for (const m of missing) {
    logger.info('Pulling model', { model: m.model, label: m.label })
    try {
      const { code, stderr } = await runPull(antfly, m.model, opts.interactive && !opts.json)
      if (code !== 0) {
        return {
          name: 'models',
          status: 'failed' as const,
          message: `antfly inference pull ${m.model} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`,
          durationMs: Date.now() - start,
        }
      }

      const verified = modelComplete(m)
      if (!verified.ok) {
        return {
          name: 'models',
          status: 'failed' as const,
          message: `antfly inference pull ${m.model} reported success but ${verified.reason}`,
          durationMs: Date.now() - start,
        }
      }
      const drifted = await unverifiedModelFiles(m.model)
      if (drifted.length > 0) {
        logger.warn('Pulled model differs from the pinned verified distribution', { model: m.model, files: drifted })
      }
      pulledLabels.push(m.label)
    } catch (err) {
      logger.error('Failed to spawn antfly inference pull', err)
      return {
        name: 'models',
        status: 'failed' as const,
        message: `Failed to pull ${m.model}: ${err instanceof Error ? err.message : String(err)}`,
        error: err,
        durationMs: Date.now() - start,
      }
    }
  }

  const durationMs = Date.now() - start
  logger.info('Search models installed', { pulled: pulledLabels, durationMs })
  return {
    name: 'models',
    status: 'installed' as const,
    message: `Pulled ${pulledLabels.length} model${pulledLabels.length === 1 ? '' : 's'}: ${pulledLabels.join(', ')}`,
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
