/**
 * ⌘K hit-renderer registry — register/lookup/unregister/HMR-hydration,
 * following the nav-badge channel pattern.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test'

const contentDirMock = () => ({
  getContentDir: () => '/tmp/bakin-test-hit-renderers',
  getBakinPaths: () => ({}),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import {
  registerPlugin,
  unregisterPlugin,
  getSearchHitRenderer,
  getSearchHitRenderersSnapshot,
  subscribeSearchHitRenderers,
} from '../../packages/sdk/src/register'

function resetRegistry(): void {
  delete (globalThis as Record<string, unknown>).__bakinClientRegistry
}

beforeEach(resetRegistry)

const descriptor = (title: string) => () => ({ title, href: `/x/${title}` })

describe('search hit-renderer registry', () => {
  it('registers renderers per content type and resolves them', () => {
    registerPlugin({ id: 'assets', search: { hitRenderers: { assets: descriptor('a') } } })
    expect(getSearchHitRenderer('assets')!({ id: '1', table: 'bakin_assets', score: 1, fields: {} }).title).toBe('a')
    expect(getSearchHitRenderer('unknown')).toBeUndefined()
  })

  it('unregisterPlugin drops only that plugin renderers and notifies', () => {
    registerPlugin({ id: 'assets', search: { hitRenderers: { assets: descriptor('a') } } })
    registerPlugin({ id: 'tasks', search: { hitRenderers: { tasks: descriptor('t') } } })
    let ticks = 0
    const unsub = subscribeSearchHitRenderers(() => { ticks++ })
    unregisterPlugin('assets')
    expect(ticks).toBe(1)
    expect(getSearchHitRenderer('assets')).toBeUndefined()
    expect(getSearchHitRenderer('tasks')).toBeDefined()
    unsub()
  })

  it('snapshot identity is stable between mutations (useSyncExternalStore safe)', () => {
    registerPlugin({ id: 'assets', search: { hitRenderers: { assets: descriptor('a') } } })
    const snap1 = getSearchHitRenderersSnapshot()
    const snap2 = getSearchHitRenderersSnapshot()
    expect(snap1).toBe(snap2)
    registerPlugin({ id: 'tasks', search: { hitRenderers: { tasks: descriptor('t') } } })
    expect(getSearchHitRenderersSnapshot()).not.toBe(snap1)
  })

  it('hydrates an HMR-retained registry that pre-dates the fields', () => {
    registerPlugin({ id: 'assets', navItems: [{ id: 'assets', label: 'Assets', href: '/assets' }] })
    // simulate an old-shape singleton: strip the new fields
    const reg = (globalThis as Record<string, unknown>).__bakinClientRegistry as Record<string, unknown>
    delete reg.hitRenderersByPlugin
    delete reg.hitRenderersSnapshot
    delete reg.hitRendererListeners
    // any registry access must self-heal
    registerPlugin({ id: 'tasks', search: { hitRenderers: { tasks: descriptor('t') } } })
    expect(getSearchHitRenderer('tasks')).toBeDefined()
  })

  it('first plugin wins on a content-type collision', () => {
    registerPlugin({ id: 'a', search: { hitRenderers: { shared: descriptor('first') } } })
    registerPlugin({ id: 'b', search: { hitRenderers: { shared: descriptor('second') } } })
    expect(getSearchHitRenderer('shared')!({ id: '1', table: 't', score: 1, fields: {} }).title).toBe('first')
  })
})
