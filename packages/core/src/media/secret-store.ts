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
 * .claude/knowledge/media-generation-adapter-architecture.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, renameSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { getContentDir } from '../content-dir'
import { resolveDirectImageKey } from './direct-image-provider'
import { type DirectImageProviderId } from './image-format'

/**
 * Named secrets per provider/integration. The historical shape
 * `{ apiKey: string }` is a valid instance (apiKey is just a secret name),
 * so pre-existing stores load unchanged — no migration code exists or is
 * needed.
 */
type ProviderSecrets = Record<string, string>

interface SecretStoreFile {
  providers: Record<string, ProviderSecrets>
}

function secretsPath(): string {
  return join(getContentDir(), 'secrets.json')
}

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Validate a provider id: a safe slug, not a reserved object key (guards
 * against prototype-pollution / silent data-loss when used as a map key).
 */
export function isValidProviderId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id) && !RESERVED_KEYS.has(id)
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
  // Write to a temp file created 0600, then atomically rename over the target.
  // This avoids the window where the plaintext-key file exists at the default
  // umask (0644) between an in-place write and a follow-up chmod.
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 })
  try {
    renameSync(tmp, path)
  } catch (err) {
    try { rmSync(tmp, { force: true }) } catch { /* ignore cleanup failure */ }
    throw err
  }
  // Belt-and-suspenders: ensure perms on platforms where rename keeps dest perms.
  try { chmodSync(path, 0o600) } catch { /* best-effort on non-POSIX */ }
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/**
 * Validate a secret name: same safe-slug rules as provider ids (camelCase
 * names like `apiKey`/`botToken` pass via the `i` flag), never a reserved
 * object key.
 */
export function isValidSecretName(name: unknown): name is string {
  return typeof name === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name) && !RESERVED_KEYS.has(name)
}

/**
 * Split a `<provider>.<name>` slot on its FIRST dot. Both segments may
 * themselves contain dots (per-package skill slots are `skills.<pack>.<VAR>`),
 * so a `split('.', 2)` here silently TRUNCATES the name — this returns the
 * whole remainder instead.
 */
export function parseSecretSlot(slot: string): { provider: string; name: string } | null {
  const dot = slot.indexOf('.')
  if (dot <= 0 || dot === slot.length - 1) return null
  return { provider: slot.slice(0, dot), name: slot.slice(dot + 1) }
}

/** Read one named secret (store only — does not consult env). */
export function getStoredSecret(providerId: string, name: string): string | null {
  return nonEmpty(readStore().providers[providerId]?.[name])
}

/** Persist one named secret to the 0600 store. Rejects invalid ids/names. */
export function setStoredSecret(providerId: string, name: string, value: string): void {
  if (!isValidProviderId(providerId)) throw new Error(`Invalid provider id: ${providerId}`)
  if (!isValidSecretName(name)) throw new Error(`Invalid secret name: ${name}`)
  const store = readStore()
  store.providers[providerId] = { ...store.providers[providerId], [name]: value }
  writeStore(store)
}

/**
 * Remove one named secret; drops the provider entry when it holds no other
 * secrets. Returns false when nothing was set.
 */
export function unsetStoredSecret(providerId: string, name: string): boolean {
  const store = readStore()
  const secrets = store.providers[providerId]
  if (!secrets || !(name in secrets)) return false
  delete secrets[name]
  if (Object.keys(secrets).length === 0) delete store.providers[providerId]
  writeStore(store)
  return true
}

/** Secret NAMES per provider (sorted) — values never leave this module unmasked callers. */
export function listStoredSecrets(): Record<string, string[]> {
  const store = readStore()
  const out: Record<string, string[]> = {}
  for (const [id, secrets] of Object.entries(store.providers)) {
    const names = Object.keys(secrets).filter(name => nonEmpty(secrets[name])).sort()
    if (names.length > 0) out[id] = names
  }
  return out
}

/** Read a stored provider key (store only — does not consult env). */
export function getStoredProviderKey(providerId: string): string | null {
  return getStoredSecret(providerId, 'apiKey')
}

/** Persist a provider key to the 0600 store. Rejects invalid/reserved ids. */
export function setStoredProviderKey(providerId: string, apiKey: string): void {
  setStoredSecret(providerId, 'apiKey', apiKey)
}

/** Remove a stored provider key. Returns false when nothing was set. */
export function unsetStoredProviderKey(providerId: string): boolean {
  return unsetStoredSecret(providerId, 'apiKey')
}

/** Provider ids that currently have a non-empty stored `apiKey` secret. */
export function listStoredProviders(): string[] {
  const store = readStore()
  return Object.keys(store.providers).filter(id => nonEmpty(store.providers[id]?.apiKey))
}

/**
 * Resolve a direct-image provider key with the full Bakin-owned precedence
 * (env override → secret store) AND report which source supplied it, so callers
 * can label the credential source accurately for diagnostics.
 *
 * Extension point (spec pi-parity §13): secret-manager references (e.g.
 * 1Password `op://vault/item/field`) would resolve HERE — env →
 * reference-resolution → stored value — so keep every read funneled through
 * this cascade rather than reading the store directly.
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

/**
 * Antfly basic-auth password. Not an API key, but it occupies the store's
 * one-secret-per-provider slot (`providers.antfly.apiKey`) so it rides the
 * same 0600 file, masked /api/secrets surface, and env-first precedence as
 * every other provider credential. settings.json keeps only the username.
 */
export function resolveAntflyPassword(): { password: string; source: 'env' | 'store' } | null {
  const env = nonEmpty(process.env.ANTFLY_PASSWORD)
  if (env) return { password: env, source: 'env' }
  const stored = getStoredProviderKey('antfly')
  if (stored) return { password: stored, source: 'store' }
  return null
}

/**
 * One-time relocation of a legacy `search.settings.auth.password` out of
 * settings.json into the secret store. Reads/writes settings.json raw
 * (overrides only, never merged defaults) so it composes with the settings
 * cache: run it BEFORE the first getSettings() of the process, or reset the
 * cache after. An already-stored secret wins — the legacy value is then
 * simply dropped from settings.json. Returns true when settings.json changed.
 */
export function migrateAntflyPasswordToSecretStore(): boolean {
  const settingsPath = join(getContentDir(), 'settings.json')
  if (!existsSync(settingsPath)) return false

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
  } catch {
    return false // corrupt settings.json is the settings loader's problem, not ours
  }

  const search = raw.search as { settings?: { auth?: Record<string, unknown> } } | undefined
  const auth = search?.settings?.auth
  const password = nonEmpty(auth?.password)
  if (!auth || !password) return false

  if (!getStoredProviderKey('antfly')) {
    setStoredProviderKey('antfly', password)
  }

  delete auth.password
  if (Object.keys(auth).length === 0) delete search!.settings!.auth
  writeFileSync(settingsPath, JSON.stringify(raw, null, 2))
  return true
}

