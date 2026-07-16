/**
 * Runtime extension trust — the ONE engine behind every surface that lists
 * or mutates extension trust (REST, CLI, doctor, runtime hub). Discovery is
 * adapter-owned and inert (`runtime.extensions?.list()`, feature-detected);
 * the trust store is the allowlist inside Bakin's adapter-settings bag
 * (`settings.runtime.settings.<adapter key>.allow`).
 *
 * TRUST IDENTITY IS (real module path, content hash). Approving names exactly
 * one file's exact bytes; a repointed symlink or a swapped file is a
 * different extension and reverts to unapproved. The adapter hands the loader
 * exactly the approved paths (a true pre-load gate: unapproved code is never
 * imported).
 *
 * Trust changes take effect on the next turn — no restart.
 */
import type { RuntimeExtensionInfo } from '@bakin/core/adapters/runtime'
import { updateSettings } from '../../packages/core/src/settings'
import { getAppServices } from '@/core/app-services'
import { appendAudit } from '@/core/audit'
import { getContentDir } from '@/core/content-dir'
import { getSettings } from '@/core/settings'
import { createLogger } from '@/core/logger'

const log = createLogger('runtime-extensions')

/** Adapter-private settings key the extension trust store lives under. */
const TRUST_SETTINGS_KEY = 'piExtensions'

/** Recoverable input error → the REST layer maps this to 4xx, not 500. */
export class ExtensionTrustError extends Error {}

export interface RuntimeExtensionsReport {
  /** Absent surface (runtime has no extension mechanism) → supported false. */
  supported: boolean
  mode: 'none' | 'allowlist' | 'all'
  extensions: RuntimeExtensionInfo[]
}

interface AllowEntry {
  path: string
  sha256: string
}

interface ExtensionsPolicyBag {
  mode?: 'none' | 'allowlist' | 'all'
  allow?: Array<AllowEntry | string>
}

function currentPolicy(): { mode: 'none' | 'allowlist' | 'all'; allow: AllowEntry[] } {
  const raw = (getSettings().runtime.settings?.[TRUST_SETTINGS_KEY] ?? {}) as ExtensionsPolicyBag
  const allow = (raw.allow ?? []).map((e) => (typeof e === 'string' ? { path: e, sha256: '' } : { path: e.path, sha256: e.sha256 ?? '' }))
  return { mode: raw.mode ?? 'allowlist', allow }
}

/**
 * Write ONLY the allowlist delta. updateSettings deep-merges into the ON-DISK
 * overrides, so a minimal patch preserves every other setting AND never
 * persists merged defaults or the runtime-adapter env override into
 * settings.json (spreading the resolved `runtime` object would).
 */
function writeAllowlist(allow: AllowEntry[]): void {
  updateSettings({ runtime: { settings: { [TRUST_SETTINGS_KEY]: { mode: currentPolicy().mode, allow } } } })
}

/** allow/revoke only mean something under 'allowlist' — refuse in 'none'/'all' honestly. */
function requireAllowlistMode(mode: 'none' | 'allowlist' | 'all', verb: string): void {
  if (mode === 'allowlist') return
  throw new ExtensionTrustError(
    mode === 'all'
      ? `Extension policy is "all": every installed extension already loads. Set ${TRUST_SETTINGS_KEY}.mode to "allowlist" to ${verb} individually.`
      : `Extension policy is "none": all extensions are blocked. Set ${TRUST_SETTINGS_KEY}.mode to "allowlist" to ${verb} individually.`,
  )
}

export async function listRuntimeExtensions(): Promise<RuntimeExtensionsReport> {
  const surface = getAppServices().runtime.extensions
  if (!surface) return { supported: false, mode: currentPolicy().mode, extensions: [] }
  return { supported: true, mode: currentPolicy().mode, extensions: await surface.list() }
}

/**
 * Approve one discovered extension: its (real path, current hash) joins the
 * allowlist. Refuses ids discovery doesn't return — trust is granted to a
 * real file the runtime would import, never a free-text pattern.
 */
export async function allowRuntimeExtension(id: string): Promise<RuntimeExtensionsReport> {
  const report = await listRuntimeExtensions()
  if (!report.supported) throw new ExtensionTrustError('The active runtime has no extension mechanism')
  requireAllowlistMode(report.mode, 'allow')
  const target = report.extensions.find((e) => e.id === id)
  if (!target) throw new ExtensionTrustError(`Unknown extension "${id}" — run discovery first (bakin runtime extensions list)`)

  const policy = currentPolicy()
  const next = policy.allow.filter((e) => e.path !== target.path)
  next.push({ path: target.path, sha256: target.sha256 })
  writeAllowlist(next)
  appendAudit(getContentDir(), 'runtime.extension_allowed', target.path, { label: target.label, source: target.source, sha256: target.sha256 }, 'human')
  log.info(`Extension allowed`, { path: target.path })
  return listRuntimeExtensions()
}

/** Revoke one extension by its path: it leaves the allowlist and stops loading. */
export async function revokeRuntimeExtension(id: string): Promise<RuntimeExtensionsReport> {
  const report = await listRuntimeExtensions()
  if (!report.supported) throw new ExtensionTrustError('The active runtime has no extension mechanism')
  requireAllowlistMode(report.mode, 'revoke')

  const policy = currentPolicy()
  const next = policy.allow.filter((e) => e.path !== id)
  if (next.length === policy.allow.length) {
    throw new ExtensionTrustError(`Extension "${id}" is not in the allowlist`)
  }
  writeAllowlist(next)
  appendAudit(getContentDir(), 'runtime.extension_revoked', id, {}, 'human')
  log.info(`Extension revoked`, { path: id })
  return listRuntimeExtensions()
}
