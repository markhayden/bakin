import { createLogger } from '../logger'
import { getSearchAdapterModelsRoot, getSearchAdapterRequiredModels, getSearchAdapterSetup } from '../search-adapter-factory'
import { installSearchComponentLocally } from '../search-setup-install'
import { getSettings } from '../settings'
import { askYesNo } from './prompts'
import type { OnboardingComponent } from './types'

export interface SearchModel {
  label: string
  model: string
  kind: string
}

/**
 * The models required by the ACTIVE settings — resolved at call time so a
 * settings change (custom embedder, reranker toggled on) is reflected without
 * a restart. Never cache this at module load: that snapshots defaults.
 */
export function requiredSearchModels(): readonly SearchModel[] {
  return getSearchAdapterRequiredModels('antfly', getSettings().search.settings) as readonly SearchModel[]
}

export function searchModelsRoot(): string {
  return getSearchAdapterModelsRoot('antfly')
}

const log = createLogger('onboarding:search-models')

function setup() {
  const settings = getSettings().search.settings
  const s = getSearchAdapterSetup('antfly', log, settings)
  if (!s.models) throw new Error('Configured search adapter does not expose a model setup component')
  return { models: s.models, settings }
}

export const searchModelsComponent: OnboardingComponent = {
  name: 'search-models',
  check: () => setup().models.check().then((result) => ({ ...result, name: 'search-models' })),
  install: (opts) => installSearchComponentLocally(() => { const current = setup(); return { component: current.models, settings: current.settings } }, {
    ...opts,
    autoApprove: opts.autoApprove || opts.approvedComponents?.includes('search-models') === true,
    askYesNo,
  }, { kind: 'install:search-models', title: 'Download the search models', failureCode: 'models_install_failed' }).then((result) => ({ ...result, name: 'search-models' })),
}
