/**
 * Bakin-owned provider secret store.
 *
 * Holds direct-provider API keys (openai, google, fal, …) used by the shared
 * media shims when a runtime can't serve a route natively — and, crucially, for
 * providers no runtime fronts at all (a runtime can't own credentials for a
 * service it has never heard of). Keyed per PROVIDER, not per plugin, so one
 * key serves every modality (image, video, …).
 *
 * Resolution order is env → store: an env var always overrides the stored
 * value, so power users / CI can keep keys out of disk. The store is a
 * dedicated `~/.bakin/secrets.json` written `0600`, separate from the broadcast
 * settings.json so a secret never rides an SSE frame or a settings export.
 *
 * Plaintext at rest is the accepted trade for a single-user, self-hosted box;
 * the env override + 0600 + dedicated-file mitigations bound the risk. See
 * .claude/specs/media-generation-adapter-architecture.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { dirname, join } from 'path'
import { getContentDir } from '../content-dir'
import { resolveDirectImageKey, type DirectImageProviderId } from './direct-image-provider'

interface ProviderSecret {
  apiKey?: string
}

interface SecretStoreFile {
  providers: Record<string, ProviderSecret>
}

function secretsPath(): string {
  return join(getContentDir(), 'secrets.json')
}

function readStore(): SecretStoreFile {
  const path = secretsPath()
  if (!existsSync(path)) return { providers: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (parsed && typeof parsed === 'object' && 'providers' in parsed && typeof (parsed as SecretStoreFile).providers === 'object') {
      return parsed as SecretStoreFile
    }
  } catch {
    /* fall through to empty store — a corrupt file must not crash resolution */
  }
  return { providers: {} }
}

function writeStore(store: SecretStoreFile): void {
  const path = secretsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(store, null, 2))
  try {
    chmodSync(path, 0o600)
  } catch {
    /* best-effort on platforms without POSIX perms */
  }
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/** Read a stored provider key (store only — does not consult env). */
export function getStoredProviderKey(providerId: string): string | null {
  return nonEmpty(readStore().providers[providerId]?.apiKey)
}

/** Persist a provider key to the 0600 store. */
export function setStoredProviderKey(providerId: string, apiKey: string): void {
  const store = readStore()
  store.providers[providerId] = { apiKey }
  writeStore(store)
}

/** Remove a stored provider key. Returns false when nothing was set. */
export function unsetStoredProviderKey(providerId: string): boolean {
  const store = readStore()
  if (!store.providers[providerId]) return false
  delete store.providers[providerId]
  writeStore(store)
  return true
}

/** Provider ids that currently have a non-empty stored key. */
export function listStoredProviders(): string[] {
  const store = readStore()
  return Object.keys(store.providers).filter(id => nonEmpty(store.providers[id]?.apiKey))
}

/**
 * Resolve a direct-image provider key with the full Bakin-owned precedence
 * (env override → secret store) AND report which source supplied it, so callers
 * can label the credential source accurately for diagnostics.
 */
export function resolveProviderApiKeySource(
  provider: DirectImageProviderId,
): { apiKey: string; source: 'env' | 'store' } | null {
  const env = resolveDirectImageKey(provider)
  if (env) return { apiKey: env, source: 'env' }
  const stored = getStoredProviderKey(provider)
  if (stored) return { apiKey: stored, source: 'store' }
  return null
}

/** Resolve a key with env → store precedence (no source label). */
export function resolveProviderApiKey(provider: DirectImageProviderId): string | null {
  return resolveProviderApiKeySource(provider)?.apiKey ?? null
}
