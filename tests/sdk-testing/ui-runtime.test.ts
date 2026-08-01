import { afterEach, describe, expect, it } from 'bun:test'

import {
  DEFAULT_PLUGIN_UI_FIXTURE,
  PLUGIN_UI_VIEWPORTS,
  createDeterministicIdFactory,
  createDeterministicRandom,
  createPluginUiFixtureFetch,
  installPluginUiFixture,
  normalizePluginUiFixtureRoute,
} from '@makinbakin/sdk/testing/ui'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe('@makinbakin/sdk/testing/ui deterministic runtime', () => {
  it('publishes canonical desktop and mobile browser viewports', () => {
    expect(PLUGIN_UI_VIEWPORTS).toEqual({
      desktop: { width: 1440, height: 900 },
      mobile: { width: 320, height: 800 },
    })
    expect(DEFAULT_PLUGIN_UI_FIXTURE.viewport).toBe('desktop')
  })

  it('accepts only root-relative application routes', () => {
    expect(normalizePluginUiFixtureRoute('/projects/abc?tab=activity#latest'))
      .toBe('/projects/abc?tab=activity#latest')
    expect(() => normalizePluginUiFixtureRoute('https://example.com/projects'))
      .toThrow('root-relative application path')
    expect(() => normalizePluginUiFixtureRoute('//example.com/projects'))
      .toThrow('root-relative application path')
  })

  it('repeats seeded random and id sequences', () => {
    const left = createDeterministicRandom('plugin-ui')
    const right = createDeterministicRandom('plugin-ui')
    expect([left(), left(), left()]).toEqual([right(), right(), right()])

    const nextId = createDeterministicIdFactory('fixture')
    expect([nextId(), nextId()]).toEqual(['fixture-0001', 'fixture-0002'])
  })

  it('serves declared network fixtures and rejects unhandled requests', async () => {
    const fixtureFetch = createPluginUiFixtureFetch([
      { path: '/api/items?status=open', status: 200, json: { items: ['one'] } },
      { method: 'POST', path: '/api/items', status: 204 },
    ])

    expect(await (await fixtureFetch('/api/items?status=open')).json()).toEqual({ items: ['one'] })
    expect((await fixtureFetch('/api/items', { method: 'POST' })).status).toBe(204)
    await expect(fixtureFetch('/api/missing')).rejects.toThrow(
      'Unhandled plugin UI fixture request: GET /api/missing',
    )
  })

  it('installs and restores time, randomness, fetch, and root fixture metadata', () => {
    const originalDate = globalThis.Date
    const originalFetch = globalThis.fetch
    const originalRandom = globalThis.Math.random
    const originalUuid = globalThis.crypto.randomUUID
    const originalRoute = document.documentElement.getAttribute('data-bakin-fixture-route')
    const originalViewport = document.documentElement.getAttribute('data-bakin-fixture-viewport')
    const cleanup = installPluginUiFixture({
      fixedNow: '2026-02-03T04:05:06.000Z',
      route: '/fixture?mode=ready',
      randomSeed: 'runtime-test',
      colorScheme: 'light',
      reducedMotion: false,
      viewport: 'mobile',
      network: [],
    })
    cleanups.push(cleanup)

    expect(new Date().toISOString()).toBe('2026-02-03T04:05:06.000Z')
    expect(document.documentElement.dataset.bakinFixtureRoute).toBe('/fixture?mode=ready')
    expect(document.documentElement.dataset.bakinFixtureViewport).toBe('mobile')
    expect(document.documentElement.dataset.bakinColorScheme).toBe('light')
    expect([crypto.randomUUID(), crypto.randomUUID()]).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ])

    cleanup()
    cleanups.pop()
    expect(globalThis.Date).toBe(originalDate)
    expect(globalThis.fetch).toBe(originalFetch)
    expect(globalThis.Math.random).toBe(originalRandom)
    expect(globalThis.crypto.randomUUID).toBe(originalUuid)
    expect(document.documentElement.getAttribute('data-bakin-fixture-route')).toBe(originalRoute)
    expect(document.documentElement.getAttribute('data-bakin-fixture-viewport')).toBe(originalViewport)
  })
})
