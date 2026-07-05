/**
 * Loader-resolution tests for the unified curated catalog: static-first,
 * embedded fallback, graceful degradation. Successor to the old
 * onboarding curated-catalog loader test.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'

// Per CLAUDE.md — defensive content-dir mocks even for loader tests.
mock.module('../../src/core/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-curated-load-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})
mock.module('../../packages/core/src/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-curated-load-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})

import { setEmbeddedAssets } from '../../packages/host/src/api/_embedded-assets'
import { loadCatalogFile } from '../../src/core/curated-catalog/load'

const originalBunFile = Bun.file

const remoteCatalog = {
  version: 2,
  updatedAt: '2026-07-04T00:00:00Z',
  entries: [
    {
      id: 'messaging',
      kind: 'plugin',
      name: 'Messaging',
      description: 'Content planning',
      category: 'Content',
      source: 'github:markhayden/bakin-bits-official#plugins/messaging',
      trust: 'official',
    },
  ],
}

describe('loadCatalogFile', () => {
  afterEach(() => {
    Bun.file = originalBunFile
    setEmbeddedAssets(new Map())
  })

  it('returns the static catalog when it has entries', async () => {
    const catalog = await loadCatalogFile(remoteCatalog)
    expect(catalog.entries.map(e => e.id)).toEqual(['messaging'])
  })

  it('uses embedded catalog data when the static JSON has no entries', async () => {
    setEmbeddedAssets(new Map([['/data/curated-catalog.json', '/$bunfs/curated-catalog.json']]))
    Bun.file = ((path: string) => ({
      exists: async () => path === '/$bunfs/curated-catalog.json',
      text: async () => JSON.stringify(remoteCatalog),
    })) as unknown as typeof Bun.file

    const catalog = await loadCatalogFile({ version: 2, updatedAt: 'x', entries: [] })
    expect(catalog.entries.map(e => e.id)).toEqual(['messaging'])
  })

  it('falls back to the empty static catalog when the embedded copy is invalid', async () => {
    setEmbeddedAssets(new Map([['/data/curated-catalog.json', '/$bunfs/curated-catalog.json']]))
    Bun.file = ((path: string) => ({
      exists: async () => path === '/$bunfs/curated-catalog.json',
      text: async () => '{ nope',
    })) as unknown as typeof Bun.file

    const catalog = await loadCatalogFile({ version: 2, updatedAt: 'x', entries: [] })
    expect(catalog.entries).toEqual([])
    expect(catalog.updatedAt).toBe('x')
  })

  it('degrades to an empty catalog when nothing anywhere is valid', async () => {
    const catalog = await loadCatalogFile({ garbage: true })
    expect(catalog.version).toBe(2)
    expect(catalog.entries).toEqual([])
  })
})
