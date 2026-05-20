import { afterEach, describe, expect, it } from 'bun:test'
import { setEmbeddedAssets } from '../../../packages/host/src/api/_embedded-assets'
import { loadCuratedCatalog } from '../../../src/core/onboarding/curated-catalog'

const originalBunFile = Bun.file

describe('curated onboarding catalog loader', () => {
  afterEach(() => {
    Bun.file = originalBunFile
    setEmbeddedAssets(new Map())
  })

  it('uses embedded catalog data when the static JSON import has no rows', async () => {
    setEmbeddedAssets(new Map([['/data/curated-plugins.json', '/$bunfs/curated-plugins.json']]))
    Bun.file = ((path: string) => ({
      exists: async () => path === '/$bunfs/curated-plugins.json',
      text: async () => JSON.stringify({
        version: 1,
        plugins: [{ id: 'messaging', name: 'Messaging' }],
      }),
    })) as unknown as typeof Bun.file

    const catalog = await loadCuratedCatalog<{ plugins?: Array<{ id: string }> }>(
      { version: 1, plugins: [] },
      '/data/curated-plugins.json',
      'plugins',
    )

    expect(catalog.plugins?.map(plugin => plugin.id)).toEqual(['messaging'])
  })

  it('prefers non-empty static catalog data', async () => {
    let readEmbedded = false
    setEmbeddedAssets(new Map([['/data/curated-plugins.json', '/$bunfs/curated-plugins.json']]))
    Bun.file = ((path: string) => ({
      exists: async () => {
        readEmbedded = true
        return path === '/$bunfs/curated-plugins.json'
      },
      text: async () => JSON.stringify({ plugins: [{ id: 'embedded' }] }),
    })) as unknown as typeof Bun.file

    const catalog = await loadCuratedCatalog<{ plugins?: Array<{ id: string }> }>(
      { version: 1, plugins: [{ id: 'static' }] },
      '/data/curated-plugins.json',
      'plugins',
    )

    expect(catalog.plugins?.map(plugin => plugin.id)).toEqual(['static'])
    expect(readEmbedded).toBe(false)
  })
})
