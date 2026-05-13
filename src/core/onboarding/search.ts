import { createLogger } from '../logger'
import { getSearchAdapterSetup } from '../search-adapter-factory'
import { askYesNo } from './prompts'
import type { OnboardingComponent } from './types'

const setup = getSearchAdapterSetup('antfly', createLogger('onboarding:search'))

export const searchComponent: OnboardingComponent = {
  name: 'search',
  check: () => setup.dependency.check().then((result) => ({ ...result, name: 'search' })),
  install: (opts) => setup.dependency.install({
    ...opts,
    autoApprove: opts.autoApprove || opts.approvedComponents?.includes('search') === true,
    askYesNo,
  }).then((result) => ({ ...result, name: 'search' })),
}
