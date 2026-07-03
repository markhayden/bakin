import type { SearchAdapter, SearchAdapterSetup } from '@bakin/core/adapters/search'
import type { AdapterLogger } from '@bakin/core/adapters/shared'
import {
  createAntflySearchAdapter,
  createAntflySearchSetup,
  findAntflyBinary,
  isAntflyInstalled,
  inferenceModelsRoot as antflyInferenceModelsRoot,
  mergeAntflySettings,
  requiredModelsForSettings as antflyRequiredModelsForSettings,
} from '@bakin/adapter-antfly'
import type { SearchAdapterName, SearchAdapterSettings } from './settings'

export function createSearchAdapter(name: SearchAdapterName): SearchAdapter {
  switch (name) {
    case 'antfly':
      return createAntflySearchAdapter()
    default:
      throw new Error(`Unknown search adapter: ${name}`)
  }
}

export function findSearchAdapterBinary(name: SearchAdapterName): string | null {
  switch (name) {
    case 'antfly':
      return findAntflyBinary()
    default:
      throw new Error(`Unknown search adapter: ${name}`)
  }
}

export function isSearchAdapterInstalled(name: SearchAdapterName): boolean {
  switch (name) {
    case 'antfly':
      return isAntflyInstalled()
    default:
      throw new Error(`Unknown search adapter: ${name}`)
  }
}

export function getSearchAdapterSetup(
  name: SearchAdapterName,
  logger?: AdapterLogger,
  settings?: SearchAdapterSettings,
): SearchAdapterSetup {
  switch (name) {
    case 'antfly':
      return createAntflySearchSetup(logger, mergeAntflySettings(settings))
    default:
      throw new Error(`Unknown search adapter: ${name}`)
  }
}

export function getSearchAdapterRequiredModels(name: SearchAdapterName, settings?: SearchAdapterSettings): readonly unknown[] {
  switch (name) {
    case 'antfly':
      return antflyRequiredModelsForSettings(mergeAntflySettings(settings))
    default:
      throw new Error(`Unknown search adapter: ${name}`)
  }
}

export function getSearchAdapterModelsRoot(name: SearchAdapterName): string {
  switch (name) {
    case 'antfly':
      return antflyInferenceModelsRoot()
    default:
      throw new Error(`Unknown search adapter: ${name}`)
  }
}
