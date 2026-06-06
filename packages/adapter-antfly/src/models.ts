import { spawn } from 'child_process'
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { SearchAdapterSetupOptions } from '@bakin/core/adapters/search'
import type { AdapterLogger } from '@bakin/core/adapters/shared'
import { inferenceModelsRoot } from './paths'
import { findAntflyBinary } from './server'

/**
 * Search-model acquisition on antfly's v0.2 inference runtime.
 *
 * Models live at ~/.antfly/inference/models/{owner}/{name}/ and are pulled
 * from HuggingFace via `antfly inference pull`. Prefetching is strongly
 * recommended: at v0.2.0-rc.2 index-time embedding does NOT lazy-download a
 * missing model — the embeddings backfill fails and does not self-heal when
 * the model later appears (bakin#456). Search stays functional (full-text
 * path, filters, facets), but semantic indexing for affected tables needs
 * `bakin install search-models` followed by `bakin reindex --rebuild`.
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
  // Xenova mirror, not openai/: the upstream openai HF repo ships no ONNX
  // exports and `inference pull` fails with NoModelFilesFound (bakin#456).
  { label: 'CLIP visual embedder', model: 'Xenova/clip-vit-base-patch32', kind: 'embedder' },
  { label: 'mxbai reranker', model: 'mixedbread-ai/mxbai-rerank-base-v1', kind: 'reranker' },
]

function modelPath(m: InferenceModel): string {
  // v0.2 layout is {root}/{owner}/{name} — no per-kind buckets.
  return join(inferenceModelsRoot(), m.model)
}

const WEIGHT_FILE_RE = /\.(onnx|gguf|safetensors)$/

function hasWeightFile(dir: string, depth = 0): boolean {
  if (depth > 2) return false
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return false
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    try {
      const stat = statSync(full)
      if (stat.isFile() && WEIGHT_FILE_RE.test(entry) && stat.size > 0) return true
      if (stat.isDirectory() && hasWeightFile(full, depth + 1)) return true
    } catch {
      continue
    }
  }
  return false
}

function modelComplete(m: InferenceModel): { ok: true } | { ok: false; reason: string } {
  const root = modelPath(m)
  if (!existsSync(root)) return { ok: false, reason: 'not downloaded yet' }

  // The registry synthesizes model_manifest.json after a successful pull;
  // its absence means the pull never completed.
  if (!existsSync(join(root, 'model_manifest.json'))) {
    return { ok: false, reason: 'model_manifest.json missing - pull likely incomplete' }
  }

  if (!hasWeightFile(root)) {
    return { ok: false, reason: 'no model weight file (.onnx/.gguf/.safetensors) found' }
  }

  return { ok: true }
}

interface MissingEntry {
  model: InferenceModel
  reason: string
}

function missingModelEntries(): MissingEntry[] {
  const out: MissingEntry[] = []
  for (const m of REQUIRED_MODELS) {
    const result = modelComplete(m)
    if (!result.ok) out.push({ model: m, reason: result.reason })
  }
  return out
}

function missingModels(): InferenceModel[] {
  return missingModelEntries().map((e) => e.model)
}

export async function checkInferenceModels() {
  const missing = missingModelEntries()
  if (missing.length === 0) {
    return {
      name: 'models',
      status: 'ok' as const,
      message: `All ${REQUIRED_MODELS.length} search models present at ${inferenceModelsRoot()}`,
      details: { root: inferenceModelsRoot(), models: REQUIRED_MODELS.map((m) => m.model) },
    }
  }
  return {
    name: 'models',
    status: 'missing' as const,
    message: `${missing.length} of ${REQUIRED_MODELS.length} search model${missing.length === 1 ? '' : 's'} not downloaded - semantic indexing is degraded until they are (search itself keeps working)`,
    remediation: 'Run `bakin install search-models`, then `bakin reindex --rebuild` if content was indexed in the meantime.',
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

export async function installInferenceModels(opts: SearchAdapterSetupOptions, logger: AdapterLogger = noopLogger) {
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

  const missing = missingModels()
  if (missing.length === 0) {
    return {
      name: 'models',
      status: 'noop' as const,
      message: `All ${REQUIRED_MODELS.length} search models already present.`,
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
        message: 'User declined model download; semantic indexing is degraded until `bakin install search-models` runs (follow with `bakin reindex --rebuild`).',
        durationMs: Date.now() - start,
      }
    }
  } else if (!opts.autoApprove) {
    return {
      name: 'models',
      status: 'skipped' as const,
      message: 'Non-interactive run without --yes; skipping model download. Semantic indexing is degraded until `bakin install search-models` runs (follow with `bakin reindex --rebuild`).',
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
