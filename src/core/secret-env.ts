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
import { delimiter } from 'path'
import { getStoredSecret } from '@bakin/core/media'
import { getBakinPaths } from '@/core/content-dir'
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
 * Prepend Bakin's bin dir (`~/.bakin/bin`) to PATH so pack-installed
 * binaries resolve in agent shell commands. Idempotent.
 */
export function ensureBakinBinOnPath(): void {
  const bin = getBakinPaths().bin
  const segments = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  if (segments.includes(bin)) return
  process.env.PATH = [bin, ...segments].join(delimiter)
}
