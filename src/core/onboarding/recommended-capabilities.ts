/**
 * Onboarding component: capability packs ("teach your agents new tricks").
 *
 * check() — two honest angles in one component:
 *   - installed capability packs that are NOT ready (missing bin/key/content)
 *     via the single readiness engine → status 'missing' with remediation
 *   - official catalog capability packs not installed yet → recommendations
 * install() — installs the selected (or defaultSelected under --yes)
 * catalog capability packs through the standard installer. Key entry is NOT
 * part of install: onboarding never stalls on a secret — readiness output
 * points at Settings → Integrations & Keys (story 1 escape hatch).
 */
import { readLockfile } from '../../../packages/core/src/agent-packages/lockfile'
import { installPackage } from '../agent-packages/installer'
import { listCapabilities } from '../agent-packages/capability-readiness'
import { loadUnifiedCatalog } from '../curated-catalog/load'
import { sourceWithRef } from '../../lib/package-source'
import type { CatalogEntry } from '../curated-catalog/schema'
import type { CheckResult, InstallResult, OnboardingComponent, OnboardingOptions } from './types'

export interface RecommendedCapability {
  id: string
  name: string
  description: string
  capability: string
  source: string
  ref: string | null
  defaultSelected: boolean
}

function normalizeCatalog(entries: readonly CatalogEntry[]): RecommendedCapability[] {
  return entries
    .filter((e) => e.kind === 'skill-pack' && e.capability !== undefined && !e.builtin && e.trust === 'official' && e.source !== undefined)
    .map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      capability: e.capability!,
      source: e.source!,
      ref: e.ref,
      defaultSelected: e.defaultSelected,
    }))
}

function installedPackIds(): Set<string> {
  const installed = new Set<string>()
  for (const [key, entry] of Object.entries(readLockfile().packages)) {
    if (entry.kind !== 'skill-pack') continue
    installed.add(key.includes('@') ? key.slice(0, key.lastIndexOf('@')) : key)
  }
  return installed
}

async function candidates(): Promise<RecommendedCapability[]> {
  const installed = installedPackIds()
  return normalizeCatalog((await loadUnifiedCatalog()).entries).filter((c) => !installed.has(c.id))
}

async function check(): Promise<CheckResult> {
  try {
    const readiness = await listCapabilities()
    const notReady = readiness.filter((c) => !c.ready)
    const missing = await candidates()

    if (notReady.length === 0 && missing.length === 0) {
      return {
        name: 'capabilities',
        status: 'ok',
        message: readiness.length === 0
          ? 'No capability packs installed (browse Explore → Capabilities)'
          : `${readiness.length} capability pack${readiness.length === 1 ? ' is' : 's are'} ready`,
        details: { ready: readiness.map((c) => c.capability), recommended: [] },
      }
    }

    const parts: string[] = []
    if (notReady.length > 0) parts.push(`${notReady.length} installed capabilit${notReady.length === 1 ? 'y is' : 'ies are'} not ready`)
    if (missing.length > 0) parts.push(`${missing.length} recommended capability pack${missing.length === 1 ? '' : 's'} not installed`)
    return {
      name: 'capabilities',
      status: 'missing',
      message: parts.join('; '),
      remediation: notReady.length > 0
        ? notReady.flatMap((c) => c.missing).join('; ')
        : 'Install with `bakin packages install <name>` or from Explore → Capabilities.',
      details: {
        notReady: notReady.map((c) => ({ capability: c.capability, packageId: c.packageId, missing: c.missing })),
        recommended: missing.map((c) => ({ id: c.id, name: c.name, capability: c.capability, defaultSelected: c.defaultSelected })),
      },
    }
  } catch (err) {
    return {
      name: 'capabilities',
      status: 'error',
      message: `Failed to inspect capabilities: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

async function install(opts: OnboardingOptions): Promise<InstallResult> {
  const start = Date.now()
  let missing: RecommendedCapability[]
  try {
    missing = await candidates()
  } catch (err) {
    return {
      name: 'capabilities',
      status: 'failed',
      message: `Failed to inspect capability packs: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    }
  }

  const selected = opts.autoApprove ? missing.filter((c) => c.defaultSelected) : []
  if (selected.length === 0) {
    return {
      name: 'capabilities',
      status: missing.length === 0 ? 'noop' : 'skipped',
      message: missing.length === 0
        ? 'Recommended capability packs are already installed'
        : 'No capability packs selected',
      durationMs: Date.now() - start,
    }
  }

  const installed: string[] = []
  const failures: string[] = []
  for (const cap of selected) {
    try {
      opts.onProgress?.(`Installing capability pack ${cap.id}`)
      await installPackage({ source: sourceWithRef(cap.source, cap.ref), installAs: cap.id })
      installed.push(cap.id)
    } catch (err) {
      failures.push(`${cap.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const needsKeys = (await listCapabilities()).filter((c) => !c.ready)
  const keyNote = needsKeys.length > 0
    ? ` — ${needsKeys.length} need${needsKeys.length === 1 ? 's' : ''} configuration (Settings → Integrations & Keys)`
    : ''
  return {
    name: 'capabilities',
    status: failures.length > 0 ? 'failed' : 'installed',
    message: failures.length > 0
      ? `Installed ${installed.length}, failed: ${failures.join('; ')}`
      : `Installed ${installed.join(', ')}${keyNote}`,
    durationMs: Date.now() - start,
  }
}

export const recommendedCapabilitiesComponent: OnboardingComponent = {
  name: 'capabilities',
  check,
  install,
}
