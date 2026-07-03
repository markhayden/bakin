import type { SearchAdapter } from '@bakin/core/adapters/search'
import { AntflyAdapter, type AntflyAdapterOptions } from './adapter'

export { findAntflyBinary, isAntflyInstalled, getAntflyServiceStatus, type AntflyServiceStatus } from './service'
export { inferenceModelsRoot } from './paths'
export { createAntflySearchSetup, REQUIRED_MODELS, requiredModelsForSettings } from './setup'
export { mergeSettings as mergeAntflySettings, type AntflySettings } from './defaults'

export type AntflySearchAdapterOptions = AntflyAdapterOptions

export function createAntflySearchAdapter(
  options: AntflySearchAdapterOptions = {}
): SearchAdapter {
  return new AntflyAdapter(options)
}
