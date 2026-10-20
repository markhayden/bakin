/**
 * The core update sources, registered once before `startUpdates` (#1007).
 * Everything here reads through the factories — the active runtime and
 * the configured search adapter's setup — never an adapter module.
 */
import { createLogger } from '../../logger'
import { getSearchAdapterRequiredModels, getSearchAdapterSetup } from '../../search-adapter-factory'
import { getSettings } from '../../settings'
import { registerUpdateSource } from '../service'
import { createGatewaySource, type GatewaySourceDeps } from './gateway'
import { createSearchEngineSource, type SearchSettingsFacts } from './search-engine'
import { createSearchModelsSource } from './search-models'

const log = createLogger('updates-sources')

function searchSettingsFacts(): SearchSettingsFacts {
  const search = getSettings().search
  const models = getSearchAdapterRequiredModels(search.adapter, search.settings) as ReadonlyArray<{ model?: unknown }>
  return {
    adapter: search.adapter,
    url: String(search.settings.url ?? ''),
    enabled: search.settings.enabled !== false,
    requiredModelIds: models.map((m) => String(m.model ?? '')).filter(Boolean).sort(),
  }
}

export function registerCoreUpdateSources(deps: GatewaySourceDeps): void {
  const searchDeps = {
    setup: () => {
      const search = getSettings().search
      try {
        return getSearchAdapterSetup(search.adapter, log, search.settings)
      } catch (err) {
        log.warn('search adapter setup unavailable for update checks', { error: err instanceof Error ? err.message : String(err) })
        return null
      }
    },
    settings: searchSettingsFacts,
  }
  registerUpdateSource(createSearchEngineSource(searchDeps))
  registerUpdateSource(createSearchModelsSource(searchDeps))
  registerUpdateSource(createGatewaySource(deps))
}
