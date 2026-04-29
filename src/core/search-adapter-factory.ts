import type { SearchAdapter, SearchAdapterSetup } from '@bakin/core/adapters/search'
import type { AdapterLogger } from '@bakin/core/adapters/shared'
import {
  createAntflySearchAdapter,
  createAntflySearchSetup,
  findAntflyBinary,
  isAntflyInstalled,
  isAntflyRunning,
  REQUIRED_MODELS as ANTFLY_REQUIRED_MODELS,
  termiteModelsRoot as antflyTermiteModelsRoot,
} from '@bakin/adapter-antfly'
import type { SearchAdapterName } from './settings'

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

export function isSearchAdapterRunning(name: SearchAdapterName): boolean {
  switch (name) {
    case 'antfly':
      return isAntflyRunning()
    default:
      throw new Error(`Unknown search adapter: ${name}`)
  }
}

export function getSearchAdapterSetup(name: SearchAdapterName, logger?: AdapterLogger): SearchAdapterSetup {
  switch (name) {
    case 'antfly':
      return createAntflySearchSetup(logger)
    default:
      throw new Error(`Unknown search adapter: ${name}`)
  }
}

export function getSearchAdapterRequiredModels(name: SearchAdapterName): readonly unknown[] {
  switch (name) {
    case 'antfly':
      return ANTFLY_REQUIRED_MODELS
    default:
      throw new Error(`Unknown search adapter: ${name}`)
  }
}

export function getSearchAdapterModelsRoot(name: SearchAdapterName): string {
  switch (name) {
    case 'antfly':
      return antflyTermiteModelsRoot()
    default:
      throw new Error(`Unknown search adapter: ${name}`)
  }
}
