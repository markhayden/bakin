import { noteSearchEngineProgress } from '@bakin/core/search/progress'
import { createLogger } from '../logger'
import { getSearchAdapterModelsRoot, getSearchAdapterRequiredModels, getSearchAdapterSetup } from '../search-adapter-factory'
import { getSettings } from '../settings'
import type { InstallableComponent } from './types'

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

export const searchModelsComponent: InstallableComponent = {
  name: 'search-models',
  get plan() { return setup().models.plan },
  resources: ['search-engine'],
  check: () => setup().models.check().then((result) => ({ ...result, name: 'search-models' })),
  identity: () => setup().settings,
  failureCode: 'models_install_failed',
  install: async (opts, op) => {
    const result = await setup().models.install({ autoApprove: opts.autoApprove, op })
    if (result.status === 'installed' || result.status === 'noop') noteSearchEngineProgress()
    return { ...result, name: 'search-models' }
  },
}
