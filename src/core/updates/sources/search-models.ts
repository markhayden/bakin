/**
 * Required row: the search models vs their pins (#1007 D7.9). ONE subject
 * per adapter whose fingerprint hashes every model's required + installed
 * identity and state; the adapter classifies each model, core only maps
 * `remediation` to an action.
 */
import type { SearchAdapterModelCheck, SearchAdapterSetupCheckResult } from '@bakin/core/adapters/search'
import { fingerprintOf } from '../inventory'
import type { UpdateAction } from '@makinbakin/sdk/types'
import type { UpdateObservation, UpdateSource, UpdateSubjectInventoryEntry } from '../types'
import { applyRoute, type SearchSettingsFacts, type SearchSourceDeps } from './search-engine'

const INVENTORY_TIMEOUT_MS = 20_000
export const SEARCH_MODELS_INSTALL_ACTION = (adapter: string): UpdateAction => ({
  kind: 'operation',
  start: { route: applyRoute(`search-models:${adapter}`) },
  impact: ['download'],
})

function modelsEntry(adapter: string, rows: SearchAdapterModelCheck[], settings: SearchSettingsFacts): UpdateSubjectInventoryEntry {
  return {
    subject: { kind: 'search-models', id: adapter, label: `Search models (${adapter})` },
    group: 'required',
    fingerprint: fingerprintOf({
      models: rows.map((row) => ({ id: row.id, required: row.required.identity, installed: row.installed?.identity ?? 'absent', state: row.state })),
      settings,
    }),
    source: { kind: 'adapter', endpoint: adapter },
  }
}

const INSTALLABLE = new Set(['install', 'replace-variant'])

export function observeSearchModels(adapter: string, result: SearchAdapterSetupCheckResult): UpdateObservation {
  const rows = result.models ?? []
  const ready = rows.filter((row) => row.state === 'ok').length
  const installed = { display: rows.length === 0 ? 'no models required' : `${ready} of ${rows.length} models ready` }
  const actionable = rows.filter((row) => row.remediation !== undefined && INSTALLABLE.has(row.remediation))
  const stuck = rows.filter((row) => row.remediation === 'change-config' || row.remediation === 'unsupported')
  const describe = (list: SearchAdapterModelCheck[]): string => list.map((row) => `${row.label ?? row.id}: ${row.reason ?? row.state}`).join('; ')
  if (actionable.length === 0 && stuck.length === 0) return { installed, outcome: 'current' }
  if (actionable.length > 0) {
    return {
      installed,
      available: { display: 'pinned model set' },
      reason: 'pin-mismatch',
      outcome: 'update-available',
      action: SEARCH_MODELS_INSTALL_ACTION(adapter),
      ...(stuck.length > 0 ? { blockedReason: `also not installable here — ${describe(stuck)}` } : {}),
    }
  }
  return { installed, outcome: 'blocked', blockedReason: describe(stuck), action: { kind: 'manual', pointer: result.remediation ?? 'Change the search model configuration.' } }
}

export function createSearchModelsSource(deps: SearchSourceDeps): UpdateSource {
  const check = async (signal: AbortSignal): Promise<SearchAdapterSetupCheckResult | null> => {
    const setup = deps.setup()
    const settings = deps.settings()
    if (!setup?.models || !settings.enabled) return null
    const result = await setup.models.check({ signal })
    return result.applicable ? result : null
  }
  return {
    kind: 'search-models',
    async inventory() {
      const settings = deps.settings()
      const result = await check(AbortSignal.timeout(INVENTORY_TIMEOUT_MS))
      return result ? [modelsEntry(settings.adapter, result.models ?? [], settings)] : []
    },
    async observe(_entry, { signal }) {
      const result = await check(signal)
      if (!result) throw new Error('search models are no longer applicable on this installation')
      return observeSearchModels(deps.settings().adapter, result)
    },
  }
}
