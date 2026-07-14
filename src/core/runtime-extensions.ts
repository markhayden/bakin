/**
 * Runtime extension trust — the ONE engine behind every surface that lists
 * or mutates extension trust (REST, CLI, doctor, runtime hub). Discovery is
 * adapter-owned and inert (`runtime.extensions?.list()`, feature-detected);
 * the trust store is the allowlist inside Bakin's adapter-settings bag
 * (`settings.runtime.settings.piExtensions.allow` — the knob name is the
 * adapter's, its storage is Bakin's settings.json; runtime-switch.ts is the
 * precedent for core writing that bag). Approvals persist the extension's
 * exact id — the adapter's allow predicate matches ids/basenames precisely.
 *
 * Sessions are per-turn on Pi, so trust changes take effect on the next
 * turn — no restart.
 */
import type { RuntimeExtensionInfo } from '@bakin/core/adapters/runtime'
import { getSettings, updateSettings } from '../../packages/core/src/settings'
import { getAppServices } from '@/core/app-services'
import { appendAudit } from '@/core/audit'
import { getContentDir } from '@/core/content-dir'
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

function writeAllowlist(allow: string[]): void {
  const settings = getSettings()
  const policy = currentPolicy()
  updateSettings({
    runtime: {
      ...settings.runtime,
      settings: {
        ...settings.runtime.settings,
        piExtensions: { mode: policy.mode, allow },
      },
    },
  })
}

export async function listRuntimeExtensions(): Promise<RuntimeExtensionsReport> {
  const surface = getAppServices().runtime.extensions
  if (!surface) return { supported: false, mode: currentPolicy().mode, extensions: [] }
  return { supported: true, mode: currentPolicy().mode, extensions: await surface.list() }
}

/**
 * Approve one discovered extension: its id joins the allowlist. Refuses ids
 * discovery doesn't know — trust is granted to something REAL, never to a
 * free-text pattern.
 */
export async function allowRuntimeExtension(id: string): Promise<RuntimeExtensionsReport> {
  const report = await listRuntimeExtensions()
  if (!report.supported) throw new Error('The active runtime has no extension mechanism')
  const target = report.extensions.find((e) => e.id === id)
  if (!target) throw new Error(`Unknown extension "${id}" — run discovery first (bakin runtime extensions list)`)

  const policy = currentPolicy()
  if (!policy.allow.includes(id)) writeAllowlist([...policy.allow, id])
  appendAudit(getContentDir(), 'runtime.extension_allowed', id, { path: target.path, source: target.source }, 'human')
  log.info(`Extension "${id}" allowed`, { path: target.path })
  return listRuntimeExtensions()
}

/** Revoke one extension: every allowlist entry matching its id/basename goes. */
export async function revokeRuntimeExtension(id: string): Promise<RuntimeExtensionsReport> {
  const report = await listRuntimeExtensions()
  if (!report.supported) throw new Error('The active runtime has no extension mechanism')

  const policy = currentPolicy()
  const next = policy.allow.filter((pattern) => pattern !== id)
  if (next.length === policy.allow.length) {
    throw new Error(`Extension "${id}" is not in the allowlist`)
  }
  writeAllowlist(next)
  appendAudit(getContentDir(), 'runtime.extension_revoked', id, {}, 'human')
  log.info(`Extension "${id}" revoked`)
  return listRuntimeExtensions()
}
