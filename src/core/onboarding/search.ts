import { createLogger } from '../logger'
import { getSearchAdapterSetup } from '../search-adapter-factory'
import { noteSearchEngineProgress } from '@bakin/core/search/progress'
import { getSettings, updateSettings } from '../settings'
import type { InstallableComponent } from './types'

const log = createLogger('onboarding:search')

/**
 * Pre-0.2 default URLs that may linger in settings.json. ONLY these exact
 * values are auto-corrected — a deliberate non-default URL (external/guest
 * server) is the user's choice and is never rewritten.
 */
const LEGACY_DEFAULT_URLS = new Set([
  'http://localhost:8080/api/v1',
  'http://0.0.0.0:8080/api/v1',
  'http://127.0.0.1:8080/api/v1',
  // Briefly-current default before the dial-what-we-bind fix (the server
  // binds 127.0.0.1 only; localhost resolution is machine-dependent).
  'http://localhost:3738',
])

const CURRENT_DEFAULT_URL = 'http://127.0.0.1:3738'

function setup() {
  const settings = getSettings().search.settings
  const legacy = typeof settings.url === 'string' && LEGACY_DEFAULT_URLS.has(settings.url)
  const effective = legacy ? { ...settings, url: CURRENT_DEFAULT_URL } : settings
  return { legacy, settings: effective, setup: getSearchAdapterSetup('antfly', log, effective) }
}

function correctLegacySettingsUrl(): string | null {
  try {
    const settings = getSettings()
    const url = settings.search?.settings?.url
    if (typeof url !== 'string' || !LEGACY_DEFAULT_URLS.has(url)) return null

    // Minimal partial ONLY: updateSettings deep-merges into the on-disk
    // overrides. Passing merged settings here would freeze every current
    // default (reranker config, embedder models, …) into settings.json as
    // explicit overrides, silently pinning users to stale defaults.
    updateSettings({ search: { settings: { url: CURRENT_DEFAULT_URL } } })
    log.info('Corrected legacy antfly URL in settings.json', { from: url, to: CURRENT_DEFAULT_URL })
    return `Updated settings.json search URL from ${url} (pre-0.2 default) to ${CURRENT_DEFAULT_URL}.`
  } catch (err) {
    log.warn('Could not check settings.json for a legacy antfly URL', { err })
    return null
  }
}

export const searchComponent: InstallableComponent = {
  name: 'search',
  // The adapter declares its stages; core never names them (D17).
  get plan() { return setup().setup.dependency.plan },
  resources: ['search-engine'],
  check: async () => {
    const current = setup()
    const result = await current.setup.dependency.check()
    return { ...result, name: 'search', ...(current.legacy && result.status === 'ok' ? { status: 'broken' as const, message: 'Search URL needs correction during installation.' } : {}) }
  },
  identity: () => setup().settings,
  failureCode: 'engine_install_failed',
  install: async (opts, op) => {
    const result = await setup().setup.dependency.install({ autoApprove: opts.autoApprove, allowServiceClaim: opts.allowServiceClaim, op })
    if (result.status !== 'installed' && result.status !== 'noop') {
      return { ...result, name: 'search' }
    }
    // A freshly (re)started engine is progress for the wedge watchdog.
    noteSearchEngineProgress()
    const urlNote = correctLegacySettingsUrl()
    return {
      ...result,
      name: 'search',
      message: urlNote ? `${result.message}\n${urlNote}` : result.message,
    }
  },
}
