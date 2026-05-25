import { describe, expect, it } from 'bun:test'

import agentCatalog from '../../../packages/host/src/data/curated-agents.json'
import pluginCatalog from '../../../packages/host/src/data/curated-plugins.json'

describe('official plugin onboarding catalog', () => {
  it('loads official plugin choices from the shipped catalog', () => {
    expect(pluginCatalog.version).toBe(1)
    expect(pluginCatalog.plugins.map(plugin => plugin.id)).toEqual(['messaging', 'projects'])
    expect(pluginCatalog.plugins.every(plugin => plugin.trust === 'official')).toBe(true)
    expect(pluginCatalog.plugins.every(plugin => plugin.defaultSelected === true)).toBe(true)
    expect(pluginCatalog.plugins.every(plugin => plugin.source.startsWith('github:markhayden/bakin-bits-official#plugins/'))).toBe(true)
  })
})

describe('official agent onboarding catalog', () => {
  it('loads official agent choices from the shipped catalog', () => {
    expect(agentCatalog.version).toBe(1)
    expect(agentCatalog.agents.map(agent => agent.id)).toEqual(['pixel', 'rolo', 'jessica', 'patch'])
    expect(agentCatalog.agents.every(agent => agent.trust === 'official')).toBe(true)
    expect(agentCatalog.agents.every(agent => agent.source.startsWith('github:markhayden/bakin-bits-official#agents/'))).toBe(true)
  })
})
