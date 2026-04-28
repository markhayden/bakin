import type { SearchAdapter } from '@bakin/core/adapters/search'
import { AntflySearchAdapter } from './search'
export { findAntflyBinary, isAntflyInstalled, isAntflyRunning } from './server'
export { createAntflySearchSetup, REQUIRED_MODELS, termiteModelsRoot, _setupInternals } from './setup'

export interface AntflySearchAdapterOptions {
  settings?: Record<string, unknown>
}

export function createAntflySearchAdapter(
  options: AntflySearchAdapterOptions = {}
): SearchAdapter {
  return new AntflySearchAdapter(options)
}
