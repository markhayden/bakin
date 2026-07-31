import { afterEach, describe, expect, it } from 'bun:test'

import {
  BAKIN_STORYBOOK_VIEWPORTS,
  DEFAULT_STORY_FIXTURE,
  STORY_FIXTURE_MANIFEST,
  createDeterministicIdFactory,
  createDeterministicRandom,
  createFixtureFetch,
  installDeterministicBrowserFixture,
  normalizeFixtureRoute,
} from '../../../storybook/fixtures'

afterEach(() => {
  // Individual tests install no globals; this documents the fixture module's
  // isolation contract and keeps later installer tests honest.
  expect(Date.now()).toBeGreaterThan(0)
})

describe('deterministic Storybook fixtures', () => {
  it('publishes stable time, route, font, viewport, theme, and motion defaults', () => {
    expect(STORY_FIXTURE_MANIFEST).toEqual({
      schemaVersion: 1,
      generatedBy: 'storybook/fixtures',
      fixedNow: '2026-01-15T12:00:00.000Z',
      route: '/',
      fontFamilies: {
        sans: 'Space Grotesk',
        mono: 'JetBrains Mono',
      },
      viewports: {
        desktop: { width: 1440, height: 900 },
        mobile: { width: 320, height: 800 },
      },
      colorScheme: 'dark',
      reducedMotion: 'system',
      network: 'reject-unhandled',
    })
    expect(DEFAULT_STORY_FIXTURE.network).toEqual([])
    expect(BAKIN_STORYBOOK_VIEWPORTS).toEqual({
      desktop: {
        name: 'Desktop 1440 × 900',
        styles: { width: '1440px', height: '900px' },
        type: 'desktop',
      },
      mobile: {
        name: 'Mobile 320 × 800',
        styles: { width: '320px', height: '800px' },
        type: 'mobile',
      },
    })
  })

  it("resolves the 'system' motion default from the real environment before shimming matchMedia", () => {
    const makeTarget = (prefersReduced: boolean, webdriver = false) => {
      const target = {
        Date,
        Math: { random: Math.random },
        fetch: globalThis.fetch,
        navigator: { webdriver },
        matchMedia: (query: string) => ({ matches: prefersReduced, media: query }) as MediaQueryList,
      }
      return target as unknown as typeof globalThis
    }

    // A human browsing session keeps real motion.
    const interactive = makeTarget(false)
    const cleanupInteractive = installDeterministicBrowserFixture({}, interactive)
    expect(interactive.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false)
    cleanupInteractive()

    // A human who prefers reduced motion keeps reduced motion.
    const reduced = makeTarget(true)
    const cleanupReduced = installDeterministicBrowserFixture({}, reduced)
    expect(reduced.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
    cleanupReduced()

    // Automation (visual harness, story-test runner) is always deterministic.
    const automated = makeTarget(false, true)
    const cleanupAutomated = installDeterministicBrowserFixture({}, automated)
    expect(automated.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
    cleanupAutomated()

    // Stories pinning an explicit boolean override the environment entirely.
    const pinned = makeTarget(true, true)
    const cleanupPinned = installDeterministicBrowserFixture({ reducedMotion: false }, pinned)
    expect(pinned.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false)
    cleanupPinned()
  })

  it('normalizes only root-relative routes from the shipped routing taxonomy', () => {
    expect(normalizeFixtureRoute('/tasks?status=todo&taskId=task-1')).toBe('/tasks?status=todo&taskId=task-1')
    expect(() => normalizeFixtureRoute('tasks')).toThrow('root-relative application path')
    expect(() => normalizeFixtureRoute('//example.com/tasks')).toThrow('root-relative application path')
    expect(() => normalizeFixtureRoute('https://example.com/tasks')).toThrow('root-relative application path')
  })

  it('repeats seeded random and ID sequences', () => {
    const randomA = createDeterministicRandom('bakin-story')
    const randomB = createDeterministicRandom('bakin-story')
    expect([randomA(), randomA(), randomA()]).toEqual([randomB(), randomB(), randomB()])

    const idsA = createDeterministicIdFactory('fixture')
    const idsB = createDeterministicIdFactory('fixture')
    expect([idsA(), idsA(), idsA()]).toEqual([
      'fixture-0001',
      'fixture-0002',
      'fixture-0003',
    ])
    expect(idsA()).toBe(idsB().replace('0001', '0004'))
  })

  it('serves declared network responses and rejects unhandled requests', async () => {
    const fixtureFetch = createFixtureFetch([
      {
        method: 'GET',
        path: '/api/plugins/example/items?state=open',
        status: 200,
        json: { items: [{ id: 'item-1' }] },
      },
    ], new URL('http://storybook.local/tasks'))

    const response = await fixtureFetch('/api/plugins/example/items?state=open')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [{ id: 'item-1' }] })
    await expect(fixtureFetch('/api/plugins/example/items?state=closed')).rejects.toThrow(
      'Unhandled plugin UI fixture request: GET /api/plugins/example/items?state=closed',
    )
  })
})
