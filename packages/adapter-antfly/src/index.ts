import type { SearchAdapter } from '@bakin/core/adapters/search'
import { AntflySearchAdapter } from './search'
export { findAntflyBinary, isAntflyInstalled, isAntflyRunning } from './server'
export { inferenceModelsRoot } from './paths'
export { createAntflySearchSetup, REQUIRED_MODELS, requiredModelsForSettings } from './setup'
export { mergeSettings as mergeAntflySettings, type AntflySettings } from './defaults'

export interface AntflySearchAdapterOptions {
  settings?: Record<string, unknown>
}

export function createAntflySearchAdapter(
  options: AntflySearchAdapterOptions = {}
): SearchAdapter {
  return new AntflySearchAdapter(options)
}
