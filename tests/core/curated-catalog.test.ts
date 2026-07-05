/**
 * Gate for the shipped unified curated catalog (v2).
 *
 * The catalog is embedded into the binary and drives both onboarding
 * recommendations and the Explore storefront — a malformed entry ships
 * broken discovery, so the file itself is schema-checked here.
 */
import { describe, expect, it, mock } from 'bun:test'

// Per CLAUDE.md — defensive content-dir mocks even for pure data tests.
mock.module('../../src/core/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-curated-catalog-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})
mock.module('../../packages/core/src/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-curated-catalog-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})

import catalogJson from '../../packages/host/src/data/curated-catalog.json'
import { CatalogFileSchema } from '../../src/core/curated-catalog/schema'
import { CORE_PLUGIN_IDS } from '../../src/lib/core-plugin-ids'

describe('shipped curated-catalog.json', () => {
  const catalog = CatalogFileSchema.parse(catalogJson)

  it('validates against the v2 schema', () => {
    expect(catalog.version).toBe(2)
    expect(typeof catalog.updatedAt).toBe('string')
    expect(catalog.entries.length).toBeGreaterThan(0)
  })

  it('ships the official agents, sourced only from the official bits repo', () => {
    const agents = catalog.entries.filter(e => e.kind === 'agent')
    expect(agents.map(a => a.id).sort()).toEqual(['enrich', 'jessica', 'patch', 'pixel', 'rolo'])
    for (const agent of agents) {
      expect(agent.source).toBe(`github:markhayden/bakin-bits-official#agents/${agent.id}`)
      expect(agent.trust).toBe('official')
      expect(agent.builtin).toBe(false)
    }
  })

  it('ships installable official plugins pointing at the official bits repo', () => {
    const installable = catalog.entries.filter(e => e.kind === 'plugin' && !e.builtin)
    expect(installable.map(p => p.id).sort()).toEqual(['messaging', 'projects'])
    for (const plugin of installable) {
      expect(plugin.source).toBe(`github:markhayden/bakin-bits-official#plugins/${plugin.id}`)
      expect(plugin.trust).toBe('official')
      expect(plugin.defaultSelected).toBe(true)
    }
  })

  it('builtin entries are core plugin ids with no source', () => {
    const builtins = catalog.entries.filter(e => e.builtin)
    expect(builtins.length).toBeGreaterThan(0)
    for (const entry of builtins) {
      expect(entry.kind).toBe('plugin')
      expect(entry.source).toBeUndefined()
      expect(CORE_PLUGIN_IDS).toContain(entry.id)
    }
  })

  it('every non-builtin entry has a github: source (no bare names)', () => {
    for (const entry of catalog.entries.filter(e => !e.builtin)) {
      expect(entry.source?.startsWith('github:')).toBe(true)
    }
  })

  it('every entry carries category and at least one use case', () => {
    for (const entry of catalog.entries) {
      expect(entry.category.length).toBeGreaterThan(0)
      expect(entry.useCases.length).toBeGreaterThan(0)
    }
  })
})
