import type { SearchAdapterSetup } from '@bakin/core/adapters/search'
import type { AdapterLogger } from '@bakin/core/adapters/shared'
import { checkAntflyDependency, installAntflyDependency } from './installer'
import { checkInferenceModels, installInferenceModels } from './models'

/**
 * Composition layer wiring the antfly setup surface for onboarding:
 * binary install lives in installer.ts, model prefetch in models.ts,
 * legacy-state cleanup in legacy-cleanup.ts.
 */

const noopLogger: AdapterLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

export { REQUIRED_MODELS, type InferenceModel } from './models'

export function createAntflySearchSetup(logger: AdapterLogger = noopLogger): SearchAdapterSetup {
  return {
    dependency: {
      name: 'antfly',
      check: () => checkAntflyDependency(),
      install: (opts) => installAntflyDependency(opts, logger),
    },
    models: {
      name: 'models',
      check: checkInferenceModels,
      install: (opts) => installInferenceModels(opts, logger),
    },
  }
}
