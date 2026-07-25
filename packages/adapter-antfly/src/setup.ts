import type { SearchAdapterSetup } from '@bakin/core/adapters/search'
import type { AdapterLogger } from '@bakin/core/adapters/shared'
import { DEFAULT_SETTINGS, type AntflySettings } from './defaults'
import { checkAntflyDependency, installAntflyDependency, resetAntflyEngineData } from './installer'
import { checkInferenceModels, installInferenceModels, requiredModelsForSettings } from './models'

/**
 * Composition layer wiring the antfly setup surface for onboarding:
 * binary install lives in installer.ts, model prefetch in models.ts.
 */

const noopLogger: AdapterLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

export { REQUIRED_MODELS, requiredModelsForSettings, type InferenceModel } from './models'

export function createAntflySearchSetup(
  logger: AdapterLogger = noopLogger,
  settings: AntflySettings = DEFAULT_SETTINGS,
): SearchAdapterSetup {
  // Only the models the active settings actually require — excludes the reranker
  // when reranking is disabled (the default), so onboarding doesn't flag a
  // disabled reranker as a missing/degraded dependency.
  const models = requiredModelsForSettings(settings)
  return {
    dependency: {
      name: 'antfly',
      check: () => checkAntflyDependency(),
      install: (opts) => installAntflyDependency(opts, logger),
    },
    models: {
      name: 'models',
      check: () => checkInferenceModels(models),
      install: (opts) => installInferenceModels(opts, logger, models),
    },
    resetEngineData: () => resetAntflyEngineData(logger),
  }
}
