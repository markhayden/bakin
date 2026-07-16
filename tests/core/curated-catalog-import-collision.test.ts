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

// THE POISONING ORDER: a file-typed import of the same JSON path must
// evaluate before the loader's plain import — the same shape server.ts
// creates via _embedded-assets-static.ts. The fixture avoids importing the
// real manifest, whose file-typed dist/vendor imports only exist post-build.
import { catalogFilePath } from '../fixtures/catalog-file-import'
import { staticCuratedCatalog } from '../../src/core/curated-catalog/load'

describe('curated catalog vs file-typed import collision', () => {
  // Worker caveat: --isolate shards can reuse a process where a sibling file
  // already plain-imported the catalog JSON — then the file-typed import
  // resolves to the CACHED OBJECT and the poisoning can't be arranged here.
  // The load-survival pin below is the real invariant and holds either way;
  // this fixture-validity pin only runs when this process's cache is virgin.
  const poisoningArranged = typeof catalogFilePath === 'string'
  it.skipIf(!poisoningArranged)('the fixture actually poisons the module cache (path string, not JSON)', () => {
    expect(typeof catalogFilePath).toBe('string')
    expect(catalogFilePath).toContain('curated-catalog')
  })

  it('staticCuratedCatalog still parses the shipped catalog', () => {
    const catalog = staticCuratedCatalog()
    expect(catalog.entries.length).toBeGreaterThan(0)
    expect(catalog.entries.some((e) => e.id === 'web-search-brave')).toBe(true)
  })
})
