import { createLogger } from '../logger'
import { getSearchAdapterSetup } from '../search-adapter-factory'
import { getSettings, updateSettings } from '../settings'
import { askYesNo } from './prompts'
import type { OnboardingComponent } from './types'

const log = createLogger('onboarding:search')
const setup = getSearchAdapterSetup('antfly', log)

/**
 * Pre-0.2 default URLs that may linger in settings.json. ONLY these exact
 * values are auto-corrected — a deliberate non-default URL (external/guest
 * server) is the user's choice and is never rewritten.
 */
const LEGACY_DEFAULT_URLS = new Set([
  'http://localhost:8080/api/v1',
  'http://0.0.0.0:8080/api/v1',
  'http://127.0.0.1:8080/api/v1',
])

const CURRENT_DEFAULT_URL = 'http://localhost:3738'

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

export const searchComponent: OnboardingComponent = {
  name: 'search',
  check: () => setup.dependency.check().then((result) => ({ ...result, name: 'search' })),
  install: (opts) => setup.dependency.install({
    ...opts,
    autoApprove: opts.autoApprove || opts.approvedComponents?.includes('search') === true,
    askYesNo,
  }).then((result) => {
    if (result.status !== 'installed' && result.status !== 'noop') {
      return { ...result, name: 'search' }
    }
    const urlNote = correctLegacySettingsUrl()
    return {
      ...result,
      name: 'search',
      message: urlNote ? `${result.message}\n${urlNote}` : result.message,
    }
  }),
}
