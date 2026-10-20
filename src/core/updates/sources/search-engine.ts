/**
 * Required row: the search engine binary vs the adapter's pin (#1007 D7.9).
 * Core reads the adapter's structured verdict — `applicable`, `installed`,
 * `required`, `status` — and never a pin or a message. Not applicable
 * (guest endpoint, disabled search, service owned elsewhere) ⇒ no subject.
 */
import type { SearchAdapterSetup, SearchAdapterSetupCheckResult } from '@bakin/core/adapters/search'
import { fingerprintOf } from '../inventory'
import type { UpdateAction } from '@makinbakin/sdk/types'
import type { UpdateObservation, UpdateSource, UpdateSubjectInventoryEntry } from '../types'

/** The normalized search settings an observation's fingerprint depends on. */
export interface SearchSettingsFacts {
  adapter: string
  url: string
  enabled: boolean
  requiredModelIds: string[]
}

export interface SearchSourceDeps {
  /** The active adapter's setup, or null when none is configured. Re-resolved per call so settings edits apply. */
  setup: () => SearchAdapterSetup | null
  settings: () => SearchSettingsFacts
}

const INVENTORY_TIMEOUT_MS = 20_000
export const SEARCH_ENGINE_INSTALL_ACTION: UpdateAction = {
  kind: 'operation',
  start: { route: '/api/runtime/onboarding/install', body: { component: 'search' } },
  impact: ['download', 'search-interruption', 'reindex'],
}

function engineEntry(adapter: string, result: SearchAdapterSetupCheckResult, settings: SearchSettingsFacts): UpdateSubjectInventoryEntry {
  return {
    subject: { kind: 'search-engine', id: adapter, label: `Search engine (${adapter})` },
    group: 'required',
    fingerprint: fingerprintOf({
      installed: result.installed?.identity ?? 'absent',
      required: result.required ?? null,
      settings,
    }),
    source: { kind: 'adapter', endpoint: adapter },
  }
}

export function observeSearchEngine(result: SearchAdapterSetupCheckResult): UpdateObservation {
  const installed = result.installed
    ? { version: result.installed.version, display: result.installed.version ? `v${result.installed.version}` : 'installed (version unknown)' }
    : { display: 'not installed' }
  const available = result.required ? { version: result.required.version, display: `v${result.required.version}` } : undefined
  switch (result.status) {
    case 'ok':
      return { installed, outcome: 'current' }
    case 'missing':
      // Binary absent → install; binary present but the service unclaimed → the
      // adapter's remediation is the operator's call, not a download.
      if (!result.installed) return { installed, available, reason: 'pin-mismatch', outcome: 'update-available', action: SEARCH_ENGINE_INSTALL_ACTION }
      return { installed, available, outcome: 'blocked', blockedReason: result.message, action: { kind: 'manual', pointer: result.remediation ?? result.message } }
    case 'broken':
      return { installed, available, reason: 'pin-mismatch', outcome: 'update-available', action: SEARCH_ENGINE_INSTALL_ACTION }
    default:
      return { installed, available, outcome: 'blocked', blockedReason: result.message, action: { kind: 'manual', pointer: result.remediation ?? result.message } }
  }
}

export function createSearchEngineSource(deps: SearchSourceDeps): UpdateSource {
  const check = async (signal: AbortSignal): Promise<SearchAdapterSetupCheckResult | null> => {
    const setup = deps.setup()
    const settings = deps.settings()
    if (!setup || !settings.enabled) return null
    const result = await setup.dependency.check({ signal })
    return result.applicable ? result : null
  }
  return {
    kind: 'search-engine',
    async inventory() {
      const settings = deps.settings()
      const result = await check(AbortSignal.timeout(INVENTORY_TIMEOUT_MS))
      return result ? [engineEntry(settings.adapter, result, settings)] : []
    },
    async observe(_entry, { signal }) {
      const result = await check(signal)
      if (!result) throw new Error('the search engine is no longer applicable on this installation')
      return observeSearchEngine(result)
    },
  }
}
