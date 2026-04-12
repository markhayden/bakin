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
import { existsSync, readFileSync, statSync } from 'fs'
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

interface ManifestFile {
  name: string
  size: number
}

/**
 * A model directory is "complete" only when `model_manifest.json` exists
 * AND every file it lists is on disk at the expected size. A bare directory
 * containing only tokenizer/config (no weights) — which is the state a
 * half-finished `antfly termite pull` leaves behind — fails this check.
 *
 * Existence-only checks let broken pulls masquerade as healthy installs;
 * we ran into exactly that with `BAAI/bge-small-en-v1.5` (config files but
 * no `model.onnx`), so the table-create call later failed at runtime with
 * `model not found` instead of being caught by the doctor.
 */
function modelComplete(m: TermiteModel): { ok: true } | { ok: false; reason: string } {
  const root = modelPath(m)
  if (!existsSync(root)) return { ok: false, reason: 'directory missing' }

  const manifestPath = join(root, 'model_manifest.json')
  if (!existsSync(manifestPath)) {
    return { ok: false, reason: 'model_manifest.json missing — pull likely incomplete' }
  }

  let manifest: { files?: ManifestFile[] }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch (err) {
    return { ok: false, reason: `model_manifest.json unreadable: ${err instanceof Error ? err.message : String(err)}` }
  }

  const files = Array.isArray(manifest.files) ? manifest.files : []
  if (files.length === 0) {
    return { ok: false, reason: 'model_manifest.json lists no files' }
  }

  for (const f of files) {
    const fpath = join(root, f.name)
    if (!existsSync(fpath)) {
      return { ok: false, reason: `${f.name} missing` }
    }
    try {
      const size = statSync(fpath).size
      if (typeof f.size === 'number' && size !== f.size) {
        return { ok: false, reason: `${f.name} size mismatch (expected ${f.size}, got ${size})` }
      }
    } catch (err) {
      return { ok: false, reason: `stat ${f.name} failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  return { ok: true }
}

interface MissingEntry {
  model: TermiteModel
  reason: string
}

function missingModels(): TermiteModel[] {
  return missingModelEntries().map((e) => e.model)
}

function missingModelEntries(): MissingEntry[] {
  const out: MissingEntry[] = []
  for (const m of REQUIRED_MODELS) {
    const result = modelComplete(m)
    if (!result.ok) out.push({ model: m, reason: result.reason })
  }
  return out
}

async function check(): Promise<CheckResult> {
  const missing = missingModelEntries()
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
    message: `${missing.length} of ${REQUIRED_MODELS.length} Termite model${missing.length === 1 ? '' : 's'} missing or incomplete`,
    remediation: 'Run `bakin install models` to (re-)download the missing Termite models.',
    details: {
      root: termiteModelsRoot(),
      missing: missing.map((e) => ({
        label: e.model.label,
        model: e.model.model,
        path: modelPath(e.model),
        reason: e.reason,
      })),
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
      // Verify the manifest + every listed file is present — catches
      // brew-like "success but no weights" failure modes where the dir
      // exists but model.onnx never landed.
      const verified = modelComplete(m)
      if (!verified.ok) {
        return {
          name: 'models',
          status: 'failed',
          message: `antfly termite pull ${m.model} reported success but ${verified.reason}`,
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
export const _internals = { missingModels, missingModelEntries, modelPath, modelComplete, runPull }
