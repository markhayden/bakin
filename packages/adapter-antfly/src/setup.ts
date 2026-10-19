import type { SearchAdapterSetup, SearchAdapterSetupOptions } from '@bakin/core/adapters/search'
import type { AdapterLogger } from '@bakin/core/adapters/shared'
import { isLocalDefaultUrl } from './paths'
import { DEFAULT_SETTINGS, type AntflySettings } from './defaults'
import { ANTFLY_ENGINE_PLAN, checkAntflyDependency, installAntflyDependency, resetAntflyEngineData } from './installer'
import { ANTFLY_MODELS_PLAN, checkInferenceModels, installInferenceModels, requiredModelsForSettings } from './models'

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
  const external = (opts: SearchAdapterSetupOptions) => {
    for (const stage of ANTFLY_MODELS_PLAN.stages) opts.op.skip(stage.id, 'managed at the configured external endpoint')
    return Promise.resolve({ name: 'models', status: 'noop' as const, message: 'Search models are managed at the configured external endpoint.', durationMs: 0 })
  }
  return {
    dependency: {
      name: 'antfly',
      plan: ANTFLY_ENGINE_PLAN,
      check: () => checkAntflyDependency(undefined, settings),
      install: (opts) => installAntflyDependency(opts, logger, undefined, {}, settings),
    },
    models: {
      name: 'models',
      plan: ANTFLY_MODELS_PLAN,
      check: () => isLocalDefaultUrl(settings.url) ? checkInferenceModels(models) : Promise.resolve({ name: 'models', status: 'ok', message: 'Search models are managed at the configured external endpoint.' }),
      install: (opts) => isLocalDefaultUrl(settings.url) ? installInferenceModels(opts, logger, models) : external(opts),
    },
    resetEngineData: (op) => resetAntflyEngineData(op, logger, settings),
  }
}
