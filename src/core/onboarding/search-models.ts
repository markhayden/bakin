import { createLogger } from '../logger'
import { getSearchAdapterModelsRoot, getSearchAdapterRequiredModels, getSearchAdapterSetup } from '../search-adapter-factory'
import { askYesNo } from './prompts'
import type { OnboardingComponent } from './types'

export interface SearchModel {
  label: string
  model: string
  kind: string
}

export const REQUIRED_MODELS = getSearchAdapterRequiredModels('antfly') as readonly SearchModel[]

export function searchModelsRoot(): string {
  return getSearchAdapterModelsRoot('antfly')
}

const setup = getSearchAdapterSetup('antfly', createLogger('onboarding:search-models'))
if (!setup.models) throw new Error('Configured search adapter does not expose a model setup component')

export const searchModelsComponent: OnboardingComponent = {
  name: 'search-models',
  check: () => setup.models!.check().then((result) => ({ ...result, name: 'search-models' })),
  install: (opts) => setup.models!.install({ ...opts, askYesNo }).then((result) => ({ ...result, name: 'search-models' })),
}
