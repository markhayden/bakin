/**
 * `bakin search:reset` / POST /api/search/reset — the one-command clean
 * slate for a corrupted or wedged search engine: the adapter stops its
 * engine, wipes DERIVED data (indexes only — models and source content
 * are untouched), starts clean, and a repair reindex regenerates every
 * table from source. This exact sequence was assembled by hand across
 * eight separate recovery steps in the 2026-07-21 field incident; the
 * verb exists so nobody does that again.
 */
import { createLogger } from './logger'
import { getSearchAdapterSetup } from './search-adapter-factory'
import { startReindexJob, type ReindexJobStatus } from './search-registry-core'
import { getSettings } from './settings'

const log = createLogger('search-reset')

export interface SearchResetResult {
  ok: boolean
  message: string
  job: ReindexJobStatus | null
}

export async function resetSearchEngine(): Promise<SearchResetResult> {
  const settings = getSettings()
  if (!settings.search.settings.enabled) {
    return { ok: false, message: 'Search is disabled in settings — enable it before resetting.', job: null }
  }
  const setup = getSearchAdapterSetup(settings.search.adapter, undefined, settings.search.settings)
  if (!setup.resetEngineData) {
    return { ok: false, message: `The '${settings.search.adapter}' search adapter does not support engine reset.`, job: null }
  }
  log.warn('search engine reset requested — wiping derived engine data and rebuilding')
  const result = await setup.resetEngineData()
  if (result.status !== 'installed') {
    return { ok: false, message: result.message, job: null }
  }
  // Repair-by-default: every registry row whose physical vanished with the
  // wipe regenerates; queries come back table by table in product-priority
  // order as backfills converge.
  const job = startReindexJob()
  return { ok: true, message: result.message, job }
}
