import type { SearchAdapter } from '@bakin/core/adapters/search'
import { AntflySearchAdapter } from './search'

export interface AntflySearchAdapterOptions {
  settings?: Record<string, unknown>
}

export function createAntflySearchAdapter(
  options: AntflySearchAdapterOptions = {}
): SearchAdapter {
  return new AntflySearchAdapter(options)
}
