import { describe, expect, it, mock } from 'bun:test'

// Per CLAUDE.md — defensive content-dir mocks; the RECOMMENDED_* exports are
// derived from the statically imported catalog, but their modules transitively
// import lockfile/agent-state code that resolves the content dir.
mock.module('../../../src/core/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-recommended-catalogs-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})
mock.module('../../../packages/core/src/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-recommended-catalogs-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})

import { RECOMMENDED_AGENTS } from '../../../src/core/onboarding/recommended-agents'
import { RECOMMENDED_PLUGINS } from '../../../src/core/onboarding/recommended-plugins'

describe('official plugin onboarding recommendations', () => {
  it('derives official plugin choices from the unified catalog', () => {
    expect(RECOMMENDED_PLUGINS.map(plugin => plugin.id)).toEqual(['messaging', 'projects'])
    expect(RECOMMENDED_PLUGINS.every(plugin => plugin.trust === 'official')).toBe(true)
    expect(RECOMMENDED_PLUGINS.every(plugin => plugin.defaultSelected === true)).toBe(true)
    expect(RECOMMENDED_PLUGINS.every(plugin => plugin.source.startsWith('github:markhayden/bakin-bits-official#plugins/'))).toBe(true)
  })

  it('never recommends builtin core plugins', () => {
    expect(RECOMMENDED_PLUGINS.map(plugin => plugin.id)).not.toContain('team')
    expect(RECOMMENDED_PLUGINS.map(plugin => plugin.id)).not.toContain('explore')
  })
})

describe('official agent onboarding recommendations', () => {
  it('derives official agent choices from the unified catalog', () => {
    expect(RECOMMENDED_AGENTS.map(agent => agent.id)).toEqual(['pixel', 'rolo', 'jessica', 'patch', 'enrich'])
    expect(RECOMMENDED_AGENTS.every(agent => agent.trust === 'official')).toBe(true)
    expect(RECOMMENDED_AGENTS.every(agent => agent.source.startsWith('github:markhayden/bakin-bits-official#agents/'))).toBe(true)
  })

  it('preserves the enrichment agent default selection', () => {
    const enrich = RECOMMENDED_AGENTS.find(agent => agent.id === 'enrich')
    expect(enrich?.defaultSelected).toBe(true)
    expect(RECOMMENDED_AGENTS.filter(agent => agent.defaultSelected).map(a => a.id)).toEqual(['enrich'])
  })
})
