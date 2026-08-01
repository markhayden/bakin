import { describe, expect, it } from 'bun:test'

import { IMITATION_CRAB_MODELS } from '../../dev/imitation-crab/model-catalog'
import openClawFixture from '../../dev/imitation-crab/fixtures/openclaw.json'

describe('imitation-crab model catalog', () => {
  it('provides enough realistic available models to exercise filtering and pagination', () => {
    expect(IMITATION_CRAB_MODELS.length).toBeGreaterThanOrEqual(10)
    expect(new Set(IMITATION_CRAB_MODELS.map((model) => model.key.split('/')[0])).size).toBeGreaterThanOrEqual(3)
    expect(IMITATION_CRAB_MODELS.every((model) => model.available)).toBe(true)
    expect(IMITATION_CRAB_MODELS.some((model) => model.tags?.includes('configured'))).toBe(true)
  })

  it('seeds realistic aliases that resolve to available models', () => {
    const aliases = openClawFixture.agents.defaults.models
    const availableIds = new Set(IMITATION_CRAB_MODELS.map((model) => model.key))

    expect(Object.keys(aliases).length).toBeGreaterThanOrEqual(3)
    expect(Object.values(aliases).every((entry) => availableIds.has(entry.alias))).toBe(true)
  })
})
