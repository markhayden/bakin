import { createLogger } from '../logger'
import { getSearchAdapterModelsRoot, getSearchAdapterRequiredModels, getSearchAdapterSetup } from '../search-adapter-factory'
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
  const s = getSearchAdapterSetup('antfly', log, getSettings().search.settings)
  if (!s.models) throw new Error('Configured search adapter does not expose a model setup component')
  return s
}

export const searchModelsComponent: OnboardingComponent = {
  name: 'search-models',
  check: () => setup().models!.check().then((result) => ({ ...result, name: 'search-models' })),
  install: (opts) => setup().models!.install({
    ...opts,
    autoApprove: opts.autoApprove || opts.approvedComponents?.includes('search-models') === true,
    askYesNo,
  }).then((result) => ({ ...result, name: 'search-models' })),
}
