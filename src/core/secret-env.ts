/**
 * Boot-time integration env + PATH injection.
 *
 * Skills installed by capability packs consume credentials via env vars
 * (e.g. BRAVE_SEARCH_API_KEY) and binaries from Bakin's own bin dir. Pi runs
 * agent sessions in-process, so agent shell commands inherit THIS server
 * process's env — one injection at boot serves every turn on every runtime.
 *
 * Precedence is env-first and unset-only: a value already present in the
 * environment always wins and is never overwritten. Injection makes stored
 * secrets readable by agent shell commands — that is the point (the keys are
 * given to agents deliberately), documented in the capability-pack docs.
 *
 * Called from server.ts boot, after the singleton lock and BEFORE app
 * services / dispatch start. Never call from createAppServices() — read-only
 * CLI paths must not mutate the process environment.
 */
import { existsSync, readFileSync } from 'fs'
import { delimiter, join } from 'path'
import { getStoredSecret } from '@bakin/core/media'
import { readLockfile } from '../../packages/core/src/agent-packages/lockfile'
import { safeParseManifest } from '../../packages/core/src/agent-packages/manifest'
import { getPackageSourceDir } from '../../packages/core/src/agent-packages/package-paths'
import { getBakinPaths, getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'

const log = createLogger('secret-env')

export interface EnvSecretMapping {
  /** Environment variable the consumer (skill/CLI) reads. */
  envVar: string
  /** Secret-store provider slot. */
  provider: string
  /** Secret-store secret name. */
  name: string
}

/**
 * Static mappings for integrations Bakin knows about regardless of installed
 * packs. Capability packs add their own declarations (manifest `secrets[]`
 * with `secretSlot`, P2) — those are passed in by the caller at boot.
 */
export const STATIC_ENV_SECRET_MAPPINGS: EnvSecretMapping[] = [
  { envVar: 'BRAVE_SEARCH_API_KEY', provider: 'brave', name: 'apiKey' },
]

/**
 * Populate UNSET env vars from the secret store. Returns the names of the
 * vars actually injected (for boot logging/diagnostics — never values).
 */
export function injectIntegrationEnv(
  mappings: EnvSecretMapping[] = STATIC_ENV_SECRET_MAPPINGS,
): string[] {
  const injected: string[] = []
  for (const { envVar, provider, name } of mappings) {
    if (process.env[envVar] !== undefined && process.env[envVar] !== '') continue
    const stored = getStoredSecret(provider, name)
    if (!stored) continue
    process.env[envVar] = stored
    injected.push(envVar)
  }
  if (injected.length > 0) log.info(`Injected ${injected.length} integration env var(s): ${injected.join(', ')}`)
  return injected
}

/**
 * Derive EnvSecretMapping[] from installed skill-pack manifests: every
 * `secrets[]` declaration with a `secretSlot` maps its env-var name to the
 * store slot. Boot injects these alongside the static list, and the live
 * injection on secret save (D18, #687) uses the same derivation — one
 * mapping source, two moments.
 */
export function collectPackSecretMappings(): EnvSecretMapping[] {
  const mappings: EnvSecretMapping[] = []
  let lock: ReturnType<typeof readLockfile>
  try {
    lock = readLockfile()
  } catch (err) {
    log.warn('Pack secret mapping collection skipped — lockfile unreadable', { error: err instanceof Error ? err.message : String(err) })
    return mappings
  }
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (entry.kind !== 'skill-pack') continue
    const id = key.includes('@') ? key.slice(0, key.lastIndexOf('@')) : key
    const manifestPath = join(
      getPackageSourceDir(getContentDir(), entry.kind, id, entry.version),
      'bakin-package.json',
    )
    if (!existsSync(manifestPath)) continue
    let manifest
    try {
      manifest = safeParseManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')))
    } catch {
      continue
    }
    if (!manifest.success) continue
    for (const secret of manifest.data.secrets ?? []) {
      if (!secret.secretSlot) continue
      const [provider, name] = secret.secretSlot.split('.', 2)
      if (!provider || !name) continue
      mappings.push({ envVar: secret.name, provider, name })
    }
  }
  return mappings
}

/**
 * Live injection after a secret save (D18, #687): inject any declared env
 * var backed by exactly this store slot, so the guided-key step takes
 * effect without a server restart. Unset-only — env still wins. Note the
 * inverse (secret DELETE) deliberately does not scrub process.env: the
 * value may have come from the real environment, and un-teaching a running
 * process a key is a restart-grade operation.
 */
export function injectSecretEnvForSlot(provider: string, name: string): string[] {
  const mappings = [...STATIC_ENV_SECRET_MAPPINGS, ...collectPackSecretMappings()]
    .filter((m) => m.provider === provider && m.name === name)
  return injectIntegrationEnv(mappings)
}

/**
 * Prepend Bakin's bin dir (`~/.bakin/bin`) to PATH so pack-installed
 * binaries resolve in agent shell commands. Idempotent.
 */
export function ensureBakinBinOnPath(): void {
  const bin = getBakinPaths().bin
  const segments = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  if (segments.includes(bin)) return
  process.env.PATH = [bin, ...segments].join(delimiter)
}

/**
 * Inject env vars declared by installed capability packs' model requirements
 * (`requires.models[].env`) — the consuming binary finds its model through
 * these (e.g. PARAKEET_CPP_MODEL_PATH). The literal `{dest}` expands to the
 * model's absolute installed path. Same rules as secret injection: unset-only,
 * env-first, never values in logs.
 */
export function injectPackModelEnv(): string[] {
  const injected: string[] = []
  let lock: ReturnType<typeof readLockfile>
  try {
    lock = readLockfile()
  } catch (err) {
    log.warn('Model env injection skipped — lockfile unreadable', { error: err instanceof Error ? err.message : String(err) })
    return injected
  }
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (entry.kind !== 'skill-pack') continue
    const id = key.includes('@') ? key.slice(0, key.lastIndexOf('@')) : key
    const manifestPath = join(
      getPackageSourceDir(getContentDir(), entry.kind, id, entry.version),
      'bakin-package.json',
    )
    if (!existsSync(manifestPath)) continue
    let manifest
    try {
      manifest = safeParseManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')))
    } catch (err) {
      log.warn('Model env injection skipped for pack — manifest unreadable', {
        packageKey: key, error: err instanceof Error ? err.message : String(err),
      })
      continue
    }
    if (!manifest.success || manifest.data.kind !== 'skill-pack') continue
    for (const model of manifest.data.requires?.models ?? []) {
      const dest = join(getContentDir(), 'models', model.dest)
      for (const [envVar, raw] of Object.entries(model.env ?? {})) {
        if (process.env[envVar] !== undefined && process.env[envVar] !== '') continue
        process.env[envVar] = raw.replaceAll('{dest}', dest)
        injected.push(envVar)
      }
    }
  }
  if (injected.length > 0) log.info(`Injected ${injected.length} pack model env var(s): ${injected.join(', ')}`)
  return injected
}
