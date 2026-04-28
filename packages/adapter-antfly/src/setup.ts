import { spawn } from 'child_process'
import { existsSync, readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { SearchAdapterSetup, SearchAdapterSetupOptions } from '@bakin/core/adapters/search'
import type { AdapterLogger } from '@bakin/core/adapters/shared'
import { findAntflyBinary } from './server'

const noopLogger: AdapterLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

const BREW_CANDIDATES = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']
const BREW_CASK = 'antflydb/antfly/antfly'
const BREW_INSTALL_DOCS = 'https://brew.sh/'

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

function findBrew(): string | null {
  for (const candidate of BREW_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function runSpawn(
  cmd: string,
  args: string[],
  opts: { interactive: boolean }
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: opts.interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    if (!opts.interactive) {
      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString()
      })
    }
    child.on('error', (err) => reject(err))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

async function checkAntflyDependency() {
  const binary = findAntflyBinary()
  if (binary) {
    return {
      name: 'antfly',
      status: 'ok' as const,
      message: `Antfly is installed at ${binary}`,
      details: { binary },
    }
  }
  return {
    name: 'antfly',
    status: 'missing' as const,
    message: 'Antfly binary not found on any known install path',
    remediation: `Run \`bakin install antfly\` to install via Homebrew (${BREW_CASK}).`,
  }
}

async function installAntflyDependency(opts: SearchAdapterSetupOptions, logger: AdapterLogger = noopLogger) {
  const start = Date.now()
  const existing = findAntflyBinary()
  if (existing) {
    return {
      name: 'antfly',
      status: 'noop' as const,
      message: `Antfly is already installed at ${existing}`,
      durationMs: Date.now() - start,
    }
  }

  const brew = findBrew()
  if (!brew) {
    return {
      name: 'antfly',
      status: 'failed' as const,
      message: `Homebrew not found at ${BREW_CANDIDATES.join(' or ')}. Install Homebrew first (${BREW_INSTALL_DOCS}) and rerun, or install Antfly manually.`,
      durationMs: Date.now() - start,
    }
  }

  if (opts.interactive && !opts.autoApprove) {
    const proceed = await opts.askYesNo?.(
      `Install Antfly via Homebrew? This will download ~25MB and run \`brew install --cask ${BREW_CASK}\`.`,
      true
    )
    if (!proceed) {
      return {
        name: 'antfly',
        status: 'skipped' as const,
        message: 'User declined Antfly install.',
        durationMs: Date.now() - start,
      }
    }
  } else if (!opts.autoApprove) {
    return {
      name: 'antfly',
      status: 'skipped' as const,
      message: 'Non-interactive run without --yes; skipping Antfly install.',
      durationMs: Date.now() - start,
    }
  }

  logger.info('Installing Antfly via brew', { brew, cask: BREW_CASK })
  try {
    const { code, stderr } = await runSpawn(
      brew,
      ['install', '--cask', BREW_CASK],
      { interactive: opts.interactive && !opts.json }
    )
    const durationMs = Date.now() - start
    if (code !== 0) {
      return {
        name: 'antfly',
        status: 'failed' as const,
        message: `brew install exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`,
        durationMs,
      }
    }

    const installed = findAntflyBinary()
    if (!installed) {
      return {
        name: 'antfly',
        status: 'failed' as const,
        message: 'brew install reported success but antfly binary is still not discoverable',
        durationMs,
      }
    }

    logger.info('Antfly installed successfully', { binary: installed, durationMs })
    return {
      name: 'antfly',
      status: 'installed' as const,
      message: `Installed Antfly to ${installed}`,
      durationMs,
    }
  } catch (err) {
    logger.error('Failed to spawn brew', err)
    return {
      name: 'antfly',
      status: 'failed' as const,
      message: `Failed to run brew install: ${err instanceof Error ? err.message : String(err)}`,
      error: err,
      durationMs: Date.now() - start,
    }
  }
}

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

function modelComplete(m: TermiteModel): { ok: true } | { ok: false; reason: string } {
  const root = modelPath(m)
  if (!existsSync(root)) return { ok: false, reason: 'directory missing' }

  const manifestPath = join(root, 'model_manifest.json')
  if (!existsSync(manifestPath)) {
    return { ok: false, reason: 'model_manifest.json missing - pull likely incomplete' }
  }

  let manifest: { files?: ManifestFile[] }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { files?: ManifestFile[] }
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

function missingModelEntries(): MissingEntry[] {
  const out: MissingEntry[] = []
  for (const m of REQUIRED_MODELS) {
    const result = modelComplete(m)
    if (!result.ok) out.push({ model: m, reason: result.reason })
  }
  return out
}

function missingModels(): TermiteModel[] {
  return missingModelEntries().map((e) => e.model)
}

async function checkTermiteModels() {
  const missing = missingModelEntries()
  if (missing.length === 0) {
    return {
      name: 'models',
      status: 'ok' as const,
      message: `All ${REQUIRED_MODELS.length} Termite models present at ${termiteModelsRoot()}`,
      details: { root: termiteModelsRoot(), models: REQUIRED_MODELS.map((m) => m.model) },
    }
  }
  return {
    name: 'models',
    status: 'missing' as const,
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

async function installTermiteModels(opts: SearchAdapterSetupOptions, logger: AdapterLogger = noopLogger) {
  const start = Date.now()

  const antfly = findAntflyBinary()
  if (!antfly) {
    return {
      name: 'models',
      status: 'failed' as const,
      message: 'antfly binary not found - Termite models cannot be pulled until Antfly is installed.',
      durationMs: Date.now() - start,
    }
  }

  const missing = missingModels()
  if (missing.length === 0) {
    return {
      name: 'models',
      status: 'noop' as const,
      message: `All ${REQUIRED_MODELS.length} Termite models already present.`,
      durationMs: Date.now() - start,
    }
  }

  if (opts.interactive && !opts.autoApprove) {
    const proceed = await opts.askYesNo?.(
      `Download ${missing.length} Termite model${missing.length === 1 ? '' : 's'} (~1.5GB total) to ${termiteModelsRoot()}?`,
      true
    )
    if (!proceed) {
      return {
        name: 'models',
        status: 'skipped' as const,
        message: 'User declined Termite model download.',
        durationMs: Date.now() - start,
      }
    }
  } else if (!opts.autoApprove) {
    return {
      name: 'models',
      status: 'skipped' as const,
      message: 'Non-interactive run without --yes; skipping Termite model download.',
      durationMs: Date.now() - start,
    }
  }

  logger.info('Pulling Termite models', { count: missing.length, antfly })
  const pulledLabels: string[] = []
  for (const m of missing) {
    logger.info('Pulling model', { model: m.model, label: m.label })
    try {
      const { code, stderr } = await runPull(antfly, m.model, opts.interactive && !opts.json)
      if (code !== 0) {
        return {
          name: 'models',
          status: 'failed' as const,
          message: `antfly termite pull ${m.model} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`,
          durationMs: Date.now() - start,
        }
      }

      const verified = modelComplete(m)
      if (!verified.ok) {
        return {
          name: 'models',
          status: 'failed' as const,
          message: `antfly termite pull ${m.model} reported success but ${verified.reason}`,
          durationMs: Date.now() - start,
        }
      }
      pulledLabels.push(m.label)
    } catch (err) {
      logger.error('Failed to spawn antfly termite pull', err)
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
  logger.info('Termite models installed', { pulled: pulledLabels, durationMs })
  return {
    name: 'models',
    status: 'installed' as const,
    message: `Pulled ${pulledLabels.length} model${pulledLabels.length === 1 ? '' : 's'}: ${pulledLabels.join(', ')}`,
    durationMs,
  }
}

export function createAntflySearchSetup(logger: AdapterLogger = noopLogger): SearchAdapterSetup {
  return {
    dependency: {
      name: 'antfly',
      check: checkAntflyDependency,
      install: (opts) => installAntflyDependency(opts, logger),
    },
    models: {
      name: 'models',
      check: checkTermiteModels,
      install: (opts) => installTermiteModels(opts, logger),
    },
  }
}

export const _setupInternals = {
  findBrew,
  runSpawn,
  BREW_CASK,
  BREW_CANDIDATES,
  missingModels,
  missingModelEntries,
  modelPath,
  modelComplete,
  runPull,
}
