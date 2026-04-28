import { createLogger } from '../logger'
import { getSearchAdapterSetup } from '../search-adapter-factory'
import { askYesNo } from './prompts'
import type { OnboardingComponent } from './types'

const setup = getSearchAdapterSetup('antfly', createLogger('onboarding:antfly'))

export const antflyComponent: OnboardingComponent = {
  name: setup.dependency.name,
  check: () => setup.dependency.check(),
  install: (opts) => setup.dependency.install({ ...opts, askYesNo }),
}
