import type { SearchAdapter } from '@bakin/core/adapters/search'
import { createAntflySearchAdapter, findAntflyBinary, isAntflyInstalled, isAntflyRunning } from '@bakin/adapter-antfly'
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
