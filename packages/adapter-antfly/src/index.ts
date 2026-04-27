import type { SearchAdapter } from '@bakin/core/adapters/search'
import { createMockSearchAdapter } from '@bakin/core/adapters/search/testing'

export interface AntflySearchAdapterOptions {
  settings?: Record<string, unknown>
}

export function createAntflySearchAdapter(
  options: AntflySearchAdapterOptions = {}
): SearchAdapter {
  void options
  return createMockSearchAdapter({
    name: 'antfly',
    version: '0.1.0',
    requiredCoreVersion: '^1.0.0',
  })
}
