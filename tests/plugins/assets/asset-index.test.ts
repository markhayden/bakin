import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-index-${Date.now()}`)
const assetsRoot = join(testDir, 'assets')
const storeRoot = join(assetsRoot, 'store')

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))

import { buildIndex, upsertAsset, removeAsset, listAssets, listGroupedAssets, detectVariant, getAsset, getCount } from '@bakin/assets/lib/asset-index'

// Canonical filenames under the filename-as-identity layout. The YYYYMMDD
// prefix determines the shard month; store/ layout puts every asset under
// assets/store/{YYYY-MM}/ regardless of type.
const HERO = '20260323-hero-aaaaaaaa.png'
const POST = '20260323-post-bbbbbbbb.md'
const INTRO = '20260323-intro-cccccccc.mp4'
const HERO_THUMB = '20260323-hero-aaaaaaaa.thumb.jpg'
const MONTH = '2026-03'

describe('assets/asset-index', () => {
  beforeEach(() => {
    const monthDir = join(storeRoot, MONTH)
    mkdirSync(monthDir, { recursive: true })

    writeFileSync(join(monthDir, HERO), 'fake-png')
    writeFileSync(join(monthDir, `${HERO}.meta.json`), JSON.stringify({
      agent: 'pixel',
      taskId: 'task-abc',
      created: '2026-03-23T10:00:00Z',
      type: 'images',
      tool: 'dall-e-3',
      description: 'Hero image',
      tags: ['hero', 'blog'],
    }))

    writeFileSync(join(monthDir, POST), '# My Post')
    writeFileSync(join(monthDir, `${POST}.meta.json`), JSON.stringify({
      agent: 'chef',
      taskId: 'task-def',
      created: '2026-03-23T12:00:00Z',
      type: 'text',
      description: 'Blog post draft',
      tags: ['blog', 'draft'],
    }))

    writeFileSync(join(monthDir, INTRO), 'fake-video')
    writeFileSync(join(monthDir, `${INTRO}.meta.json`), JSON.stringify({
      agent: 'rolo',
      taskId: 'task-ghi',
      created: '2026-03-23T08:00:00Z',
      type: 'video',
      tool: 'runway',
      description: 'Intro clip',
      tags: ['intro'],
    }))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('buildIndex', () => {
    it('indexes all assets from disk', () => {
      buildIndex()
      expect(getCount()).toBe(3)
    })
  })

  describe('listAssets', () => {
    it('returns all assets sorted by created desc', () => {
      buildIndex()
      const all = listAssets()
      expect(all).toHaveLength(3)
      expect(all[0].metadata.agent).toBe('chef') // 12:00
      expect(all[1].metadata.agent).toBe('pixel') // 10:00
      expect(all[2].metadata.agent).toBe('rolo')  // 08:00
    })

    it('filters by type', () => {
      buildIndex()
      const images = listAssets({ type: 'images' })
      expect(images).toHaveLength(1)
      expect(images[0].filename).toBe(HERO)
    })

    it('filters by agent', () => {
      buildIndex()
      const pixelAssets = listAssets({ agent: 'pixel' })
      expect(pixelAssets).toHaveLength(1)
      expect(pixelAssets[0].metadata.agent).toBe('pixel')
    })

    it('filters by taskId', () => {
      buildIndex()
      const taskAssets = listAssets({ taskId: 'task-def' })
      expect(taskAssets).toHaveLength(1)
      expect(taskAssets[0].filename).toBe(POST)
    })

    it('filters by tag', () => {
      buildIndex()
      const blogAssets = listAssets({ tag: 'blog' })
      expect(blogAssets).toHaveLength(2)
    })

    it('returns empty for non-matching filter', () => {
      buildIndex()
      expect(listAssets({ type: 'audio' })).toHaveLength(0)
      expect(listAssets({ agent: 'nobody' })).toHaveLength(0)
      expect(listAssets({ tag: 'nonexistent' })).toHaveLength(0)
    })
  })

  describe('getAsset', () => {
    it('retrieves a specific asset by path', () => {
      buildIndex()
      const asset = getAsset(`assets/store/${MONTH}/${HERO}`)
      expect(asset).toBeDefined()
      expect(asset!.filename).toBe(HERO)
      expect(asset!.type).toBe('images')
      expect(asset!.mimeType).toBe('image/png')
    })

    it('returns undefined for nonexistent path', () => {
      buildIndex()
      expect(getAsset(`assets/store/${MONTH}/nope.png`)).toBeUndefined()
    })
  })

  describe('upsertAsset', () => {
    it('adds a new asset to the index', () => {
      buildIndex()
      expect(getCount()).toBe(3)

      const voice = '20260323-voice-dddddddd.mp3'
      const monthDir = join(storeRoot, MONTH)
      writeFileSync(join(monthDir, voice), 'audio-data')
      writeFileSync(join(monthDir, `${voice}.meta.json`), JSON.stringify({
        agent: 'rolo',
        taskId: 'task-jkl',
        created: '2026-03-23T15:00:00Z',
        type: 'audio',
      }))

      const asset = upsertAsset(`assets/store/${MONTH}/${voice}`)
      expect(asset).not.toBeNull()
      expect(asset!.filename).toBe(voice)
      expect(getCount()).toBe(4)
    })

    it('creates a stub sidecar if none exists', () => {
      buildIndex()
      const orphan = '20260323-orphan-eeeeeeee.png'
      const monthDir = join(storeRoot, MONTH)
      writeFileSync(join(monthDir, orphan), 'data')

      const asset = upsertAsset(`assets/store/${MONTH}/${orphan}`)
      expect(asset).not.toBeNull()
      expect(asset!.metadata.agent).toBe('unknown')
      expect(existsSync(join(monthDir, `${orphan}.meta.json`))).toBe(true)
    })
  })

  describe('removeAsset', () => {
    it('removes an asset from the index', () => {
      buildIndex()
      expect(getCount()).toBe(3)

      removeAsset(`assets/store/${MONTH}/${HERO}`)
      expect(getCount()).toBe(2)
      expect(getAsset(`assets/store/${MONTH}/${HERO}`)).toBeUndefined()
    })
  })

  describe('detectVariant', () => {
    it('detects .thumb.* files as thumbnail variants', () => {
      const result = detectVariant('20260327-hero.thumb.jpg')
      expect(result).toEqual({ baseStem: '20260327-hero', role: 'thumbnail' })
    })

    it('detects .opt.* files as optimized variants', () => {
      const result = detectVariant('20260327-hero.opt.webp')
      expect(result).toEqual({ baseStem: '20260327-hero', role: 'optimized' })
    })

    it('returns null for primary assets', () => {
      expect(detectVariant('20260327-hero.jpg')).toBeNull()
      expect(detectVariant('post.md')).toBeNull()
    })

    it('returns null for .meta.json files', () => {
      expect(detectVariant('hero.png.meta.json')).toBeNull()
    })

    it('handles filenames with dots correctly', () => {
      const result = detectVariant('20260327-hero.png.thumb.jpg')
      expect(result).toEqual({ baseStem: '20260327-hero.png', role: 'thumbnail' })
    })
  })

  describe('listGroupedAssets', () => {
    it('groups thumbnail variants under their primary', () => {
      const monthDir = join(storeRoot, MONTH)
      writeFileSync(join(monthDir, HERO_THUMB), 'thumb-data')
      writeFileSync(join(monthDir, `${HERO_THUMB}.meta.json`), JSON.stringify({
        agent: 'unknown',
        taskId: 'task-abc',
        created: '2026-03-23T10:00:01Z',
        type: 'images',
      }))

      buildIndex()
      const groups = listGroupedAssets({ type: 'images' })

      expect(groups).toHaveLength(1)
      expect(groups[0].primary.filename).toBe(HERO)
      expect(groups[0].variants).toHaveLength(1)
      expect(groups[0].variants[0].role).toBe('thumbnail')
      expect(groups[0].variants[0].asset.filename).toBe(HERO_THUMB)
    })

    it('returns assets without variants as groups with empty variants array', () => {
      buildIndex()
      const groups = listGroupedAssets({ type: 'text' })

      expect(groups).toHaveLength(1)
      expect(groups[0].primary.filename).toBe(POST)
      expect(groups[0].variants).toHaveLength(0)
    })

    it('does not include variant files as separate primary entries', () => {
      const monthDir = join(storeRoot, MONTH)
      writeFileSync(join(monthDir, HERO_THUMB), 'thumb-data')

      buildIndex()

      const flat = listAssets({ type: 'images' })
      expect(flat).toHaveLength(2)

      const groups = listGroupedAssets({ type: 'images' })
      expect(groups).toHaveLength(1)
      expect(groups[0].primary.filename).toBe(HERO)
    })

    it('respects filters when grouping', () => {
      buildIndex()
      const groups = listGroupedAssets({ agent: 'pixel' })

      expect(groups).toHaveLength(1)
      expect(groups[0].primary.metadata.agent).toBe('pixel')
    })

    it('handles multiple assets with thumbnails', () => {
      const monthDir = join(storeRoot, MONTH)
      const banner = '20260323-banner-ffffffff.png'
      const bannerThumb = '20260323-banner-ffffffff.thumb.jpg'

      writeFileSync(join(monthDir, banner), 'banner-data')
      writeFileSync(join(monthDir, `${banner}.meta.json`), JSON.stringify({
        agent: 'pixel',
        taskId: 'task-zzz',
        created: '2026-03-23T14:00:00Z',
        type: 'images',
      }))
      writeFileSync(join(monthDir, bannerThumb), 'thumb-data')

      writeFileSync(join(monthDir, HERO_THUMB), 'thumb-data')

      buildIndex()
      const groups = listGroupedAssets({ type: 'images' })

      expect(groups).toHaveLength(2)
      for (const g of groups) {
        expect(g.variants).toHaveLength(1)
        expect(g.variants[0].role).toBe('thumbnail')
      }
    })
  })
})
