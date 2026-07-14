/**
 * Runtime extension trust — the ONE engine behind every surface that lists
 * or mutates extension trust (REST, CLI, doctor, runtime hub). Discovery is
 * adapter-owned and inert (`runtime.extensions?.list()`, feature-detected);
 * the trust store is the allowlist inside Bakin's adapter-settings bag
 * (`settings.runtime.settings.piExtensions.allow`).
 *
 * TRUST IDENTITY IS THE ABSOLUTE MODULE PATH the runtime would import — not
 * a name or basename, which collide across sources. Approving names exactly
 * one file; the adapter hands the loader exactly those paths (a true
 * pre-load gate: unapproved code is never imported).
 *
 * Sessions are per-turn on Pi, so trust changes take effect on the next
 * turn — no restart.
 */
import type { RuntimeExtensionInfo } from '@bakin/core/adapters/runtime'
import { updateSettings } from '../../packages/core/src/settings'
import { getAppServices } from '@/core/app-services'
import { appendAudit } from '@/core/audit'
import { getContentDir } from '@/core/content-dir'
import { getSettings } from '@/core/settings'
import { createLogger } from '@/core/logger'

const log = createLogger('runtime-extensions')

export interface RuntimeExtensionsReport {
  /** Absent surface (runtime has no extension mechanism) → supported false. */
  supported: boolean
  mode: 'none' | 'allowlist' | 'all'
  extensions: RuntimeExtensionInfo[]
}

interface ExtensionsPolicyBag {
  mode?: 'none' | 'allowlist' | 'all'
  allow?: string[]
}

function currentPolicy(): Required<ExtensionsPolicyBag> {
  const raw = (getSettings().runtime.settings?.piExtensions ?? {}) as ExtensionsPolicyBag
  return { mode: raw.mode ?? 'allowlist', allow: raw.allow ?? [] }
}

/**
 * Write ONLY the allowlist delta. updateSettings deep-merges into the ON-DISK
 * overrides, so passing a minimal patch preserves every other setting AND
 * never persists merged defaults or the BAKIN_RUNTIME_ADAPTER env override
 * into settings.json (spreading the resolved `runtime` object would).
 */
function writeAllowlist(allow: string[]): void {
  updateSettings({ runtime: { settings: { piExtensions: { mode: currentPolicy().mode, allow } } } })
}

export async function listRuntimeExtensions(): Promise<RuntimeExtensionsReport> {
  const surface = getAppServices().runtime.extensions
  if (!surface) return { supported: false, mode: currentPolicy().mode, extensions: [] }
  return { supported: true, mode: currentPolicy().mode, extensions: await surface.list() }
}

/**
 * Approve one discovered extension: its module PATH joins the allowlist.
 * Refuses ids discovery doesn't know — trust is granted to a real file the
 * runtime would import, never to a free-text pattern.
 */
export async function allowRuntimeExtension(id: string): Promise<RuntimeExtensionsReport> {
  const report = await listRuntimeExtensions()
  if (!report.supported) throw new Error('The active runtime has no extension mechanism')
  const target = report.extensions.find((e) => e.id === id)
  if (!target) throw new Error(`Unknown extension "${id}" — run discovery first (bakin runtime extensions list)`)

  const policy = currentPolicy()
  if (policy.mode === 'all') {
    throw new Error(
      'Extension policy is "all": every installed extension already loads. Set piExtensions.mode to "allowlist" to gate them individually.',
    )
  }
  if (!policy.allow.includes(target.path)) writeAllowlist([...policy.allow, target.path])
  appendAudit(getContentDir(), 'runtime.extension_allowed', target.path, { label: target.label, source: target.source }, 'human')
  log.info(`Extension allowed`, { path: target.path })
  return listRuntimeExtensions()
}

/** Revoke one extension: its path leaves the allowlist and it stops loading. */
export async function revokeRuntimeExtension(id: string): Promise<RuntimeExtensionsReport> {
  const report = await listRuntimeExtensions()
  if (!report.supported) throw new Error('The active runtime has no extension mechanism')

  const policy = currentPolicy()
  if (policy.mode === 'all') {
    throw new Error(
      'Extension policy is "all": every installed extension loads regardless of the allowlist. Set piExtensions.mode to "allowlist" to gate them individually.',
    )
  }
  const next = policy.allow.filter((path) => path !== id)
  if (next.length === policy.allow.length) {
    throw new Error(`Extension "${id}" is not in the allowlist`)
  }
  writeAllowlist(next)
  appendAudit(getContentDir(), 'runtime.extension_revoked', id, {}, 'human')
  log.info(`Extension revoked`, { path: id })
  return listRuntimeExtensions()
}
