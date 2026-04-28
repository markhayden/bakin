import { createLogger } from '../logger'
import { getSearchAdapterModelsRoot, getSearchAdapterRequiredModels, getSearchAdapterSetup } from '../search-adapter-factory'
import { askYesNo } from './prompts'
import type { OnboardingComponent } from './types'

export interface TermiteModel {
  label: string
  model: string
  kind: 'embedder' | 'reranker'
}

export const REQUIRED_MODELS = getSearchAdapterRequiredModels('antfly') as readonly TermiteModel[]

export function termiteModelsRoot(): string {
  return getSearchAdapterModelsRoot('antfly')
}

const setup = getSearchAdapterSetup('antfly', createLogger('onboarding:models'))
if (!setup.models) throw new Error('Configured search adapter does not expose a model setup component')

export const modelsComponent: OnboardingComponent = {
  name: setup.models.name,
  check: () => setup.models!.check(),
  install: (opts) => setup.models!.install({ ...opts, askYesNo }),
}
