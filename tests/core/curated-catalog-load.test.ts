/**
 * Loader-resolution tests for the unified curated catalog: embedded-first
 * (fresh disk read — dev edits show up without a restart), static-import
 * fallback, loud-logged degradation. Successor to the old onboarding
 * curated-catalog loader test.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

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

const logError = mock()
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: logError, debug: mock() }),
}))

import { setEmbeddedAssets } from '../../packages/host/src/api/_embedded-assets'
import { loadCatalogFile } from '../../src/core/curated-catalog/load'

const originalBunFile = Bun.file

const staticCatalog = {
  version: 2,
  updatedAt: 'static-date',
  entries: [
    {
      id: 'static-only',
      kind: 'agent',
      name: 'Static Only',
      description: 'from the module snapshot',
      category: 'Research',
      source: 'github:markhayden/bakin-bits-official#agents/static-only',
      trust: 'official',
    },
  ],
}

const embeddedCatalog = {
  version: 2,
  updatedAt: 'embedded-date',
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

function stubEmbedded(text: string | null): void {
  setEmbeddedAssets(new Map([['/data/curated-catalog.json', '/$bunfs/curated-catalog.json']]))
  Bun.file = ((path: string) => ({
    exists: async () => path === '/$bunfs/curated-catalog.json' && text !== null,
    text: async () => text ?? '',
  })) as unknown as typeof Bun.file
}

describe('loadCatalogFile', () => {
  beforeEach(() => {
    logError.mockClear()
    setEmbeddedAssets(new Map())
  })

  afterEach(() => {
    Bun.file = originalBunFile
    setEmbeddedAssets(new Map())
  })

  it('reads the embedded copy first — fresher than the module snapshot', async () => {
    stubEmbedded(JSON.stringify(embeddedCatalog))
    const catalog = await loadCatalogFile(staticCatalog)
    expect(catalog.updatedAt).toBe('embedded-date')
    expect(catalog.entries.map(e => e.id)).toEqual(['messaging'])
  })

  it('falls back to the static catalog when no embedded copy exists', async () => {
    const catalog = await loadCatalogFile(staticCatalog)
    expect(catalog.updatedAt).toBe('static-date')
    expect(catalog.entries.map(e => e.id)).toEqual(['static-only'])
  })

  it('logs and falls back to static when the embedded copy is malformed JSON', async () => {
    stubEmbedded('{ nope')
    const catalog = await loadCatalogFile(staticCatalog)
    expect(catalog.entries.map(e => e.id)).toEqual(['static-only'])
    expect(logError).toHaveBeenCalled()
  })

  it('logs and falls back to static when the embedded copy violates the schema', async () => {
    stubEmbedded(JSON.stringify({ version: 2, updatedAt: 'x', entries: [{ id: 'bad' }] }))
    const catalog = await loadCatalogFile(staticCatalog)
    expect(catalog.entries.map(e => e.id)).toEqual(['static-only'])
    expect(logError).toHaveBeenCalled()
  })

  it('degrades to an empty catalog with a loud log when nothing anywhere is valid', async () => {
    const catalog = await loadCatalogFile({ garbage: true })
    expect(catalog.version).toBe(2)
    expect(catalog.entries).toEqual([])
    expect(logError).toHaveBeenCalled()
  })
})
