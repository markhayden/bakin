/**
 * models component — ensures the Termite ML models Bakin relies on are
 * downloaded to ~/.termite/models/.
 *
 * Bakin's search system uses three Termite-hosted models:
 *   1. BAAI/bge-small-en-v1.5 — default text embedder (BM25 + semantic)
 *   2. openai/clip-vit-base-patch32 — visual embedder for the assets
 *      plugin's multimodal index
 *   3. mixedbread-ai/mxbai-rerank-base-v1 — cross-encoder reranker
 *
 * All three are referenced by default in settings.antfly and the live
 * server boot path will spew `[search-migration]` errors if any one is
 * missing. This component detects which models are present on disk and
 * runs `antfly termite pull <model>` for each missing one.
 *
 * Requires the antfly binary to already be installed — the T9
 * orchestrator runs this component after T5 (antfly) so the binary is
 * guaranteed to exist in the happy path. If someone calls
 * `bakin install models` directly before installing antfly, the component
 * returns 'failed' with a remediation pointing at `bakin install antfly`.
 */
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createLogger } from '../logger'
import { findBinary as findAntflyBinary } from '../antfly-server'
import { askYesNo } from './prompts'
import type { CheckResult, InstallResult, OnboardingComponent, OnboardingOptions } from './types'

const log = createLogger('onboarding:models')

/**
 * The three Termite models Bakin needs at boot. Each entry has a
 * human-readable label, the model ID to pass to `antfly termite pull`,
 * and the directory that should appear under ~/.termite/models/ once
 * the pull completes successfully. The kind decides which top-level
 * subdirectory the model lands in (embedders vs rerankers).
 */
export interface TermiteModel {
  label: string
  model: string
  kind: 'embedder' | 'reranker'
}

export const REQUIRED_MODELS: TermiteModel[] = [
  { label: 'BGE text embedder', model: 'BAAI/bge-small-en-v1.5', kind: 'embedder' },
  { label: 'CLIP visual embedder', model: 'openai/clip-vit-base-patch32', kind: 'embedder' },
  { label: 'mxbai reranker', model: 'mixedbread-ai/mxbai-rerank-base-v1', kind: 'reranker' },
]

export function termiteModelsRoot(): string {
  return join(homedir(), '.termite', 'models')
}

function modelPath(m: TermiteModel): string {
  const bucket = m.kind === 'embedder' ? 'embedders' : 'rerankers'
  return join(termiteModelsRoot(), bucket, m.model)
}

function missingModels(): TermiteModel[] {
  return REQUIRED_MODELS.filter((m) => !existsSync(modelPath(m)))
}

async function check(): Promise<CheckResult> {
  const missing = missingModels()
  if (missing.length === 0) {
    return {
      name: 'models',
      status: 'ok',
      message: `All ${REQUIRED_MODELS.length} Termite models present at ${termiteModelsRoot()}`,
      details: { root: termiteModelsRoot(), models: REQUIRED_MODELS.map((m) => m.model) },
    }
  }
  return {
    name: 'models',
    status: 'missing',
    message: `${missing.length} of ${REQUIRED_MODELS.length} Termite model${missing.length === 1 ? '' : 's'} missing`,
    remediation: 'Run `bakin install models` to download the missing Termite models.',
    details: {
      root: termiteModelsRoot(),
      missing: missing.map((m) => ({ label: m.label, model: m.model, path: modelPath(m) })),
    },
  }
}

/** Shell out to `antfly termite pull <model>`, forwarding output to TTY. */
function runPull(
  antfly: string,
  model: string,
  interactive: boolean
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(antfly, ['termite', 'pull', model], {
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

async function install(opts: OnboardingOptions): Promise<InstallResult> {
  const start = Date.now()

  const antfly = findAntflyBinary()
  if (!antfly) {
    return {
      name: 'models',
      status: 'failed',
      message: 'antfly binary not found — Termite models cannot be pulled until Antfly is installed.',
      durationMs: Date.now() - start,
    }
  }

  const missing = missingModels()
  if (missing.length === 0) {
    return {
      name: 'models',
      status: 'noop',
      message: `All ${REQUIRED_MODELS.length} Termite models already present.`,
      durationMs: Date.now() - start,
    }
  }

  // Guard on consent — model downloads are ~1.5GB total
  if (opts.interactive && !opts.autoApprove) {
    const proceed = await askYesNo(
      `Download ${missing.length} Termite model${missing.length === 1 ? '' : 's'} (~1.5GB total) to ${termiteModelsRoot()}?`,
      true
    )
    if (!proceed) {
      return {
        name: 'models',
        status: 'skipped',
        message: 'User declined Termite model download.',
        durationMs: Date.now() - start,
      }
    }
  } else if (!opts.autoApprove) {
    return {
      name: 'models',
      status: 'skipped',
      message: 'Non-interactive run without --yes; skipping Termite model download.',
      durationMs: Date.now() - start,
    }
  }

  log.info('Pulling Termite models', { count: missing.length, antfly })
  const pulledLabels: string[] = []
  for (const m of missing) {
    log.info('Pulling model', { model: m.model, label: m.label })
    try {
      const { code, stderr } = await runPull(antfly, m.model, opts.interactive && !opts.json)
      if (code !== 0) {
        return {
          name: 'models',
          status: 'failed',
          message: `antfly termite pull ${m.model} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`,
          durationMs: Date.now() - start,
        }
      }
      // Verify the directory now exists — catches brew-like "success but
      // no file" failure modes.
      if (!existsSync(modelPath(m))) {
        return {
          name: 'models',
          status: 'failed',
          message: `antfly termite pull ${m.model} reported success but ${modelPath(m)} is still missing`,
          durationMs: Date.now() - start,
        }
      }
      pulledLabels.push(m.label)
    } catch (err) {
      log.error('Failed to spawn antfly termite pull', err)
      return {
        name: 'models',
        status: 'failed',
        message: `Failed to pull ${m.model}: ${err instanceof Error ? err.message : String(err)}`,
        error: err,
        durationMs: Date.now() - start,
      }
    }
  }

  const durationMs = Date.now() - start
  log.info('Termite models installed', { pulled: pulledLabels, durationMs })
  return {
    name: 'models',
    status: 'installed',
    message: `Pulled ${pulledLabels.length} model${pulledLabels.length === 1 ? '' : 's'}: ${pulledLabels.join(', ')}`,
    durationMs,
  }
}

export const modelsComponent: OnboardingComponent = {
  name: 'models',
  check,
  install,
}

// Exported for tests.
export const _internals = { missingModels, modelPath, runPull }
