/**
 * Pin: the static catalog survives Bun's module-cache collision with
 * `_embedded-assets-static.ts`.
 *
 * Bun caches modules by path, ignoring import attributes — importing the
 * embedded-assets manifest FIRST makes the loader's plain JSON import of
 * curated-catalog.json resolve to a file-path STRING. Before the
 * shippedCatalogRaw() normalization, every source-run server (server.ts
 * evaluates the manifest at line ~49) silently degraded the static catalog
 * to empty. This test reproduces the poisoning order and pins the fix.
 */
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it, mock } from 'bun:test'

const testDir = join(tmpdir(), `bakin-test-catalog-collision-${Date.now()}`)
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

// THE POISONING ORDER: the file-typed manifest import must evaluate before
// the loader's JSON import — exactly what server.ts does.
import '../../packages/host/src/api/_embedded-assets-static'
import { staticCuratedCatalog } from '../../src/core/curated-catalog/load'

describe('curated catalog vs file-typed import collision', () => {
  it('staticCuratedCatalog still parses the shipped catalog', () => {
    const catalog = staticCuratedCatalog()
    expect(catalog.entries.length).toBeGreaterThan(0)
    expect(catalog.entries.some((e) => e.id === 'web-search-brave')).toBe(true)
  })
})
