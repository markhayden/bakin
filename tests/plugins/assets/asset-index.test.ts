import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock content-dir before importing asset-index
const testDir = join(tmpdir(), `bakin-test-index-${Date.now()}`)
const assetsRoot = join(testDir, 'assets')

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))

import { buildIndex, upsertAsset, removeAsset, listAssets, listGroupedAssets, detectVariant, getAsset, getCount } from '@bakin/assets/lib/asset-index'
import { resolveFilename, clearResolver, resolverSize } from '@bakin/assets/lib/resolver'

describe('assets/asset-index', () => {
  beforeEach(() => {
    // Create test directory structure
    const types = ['text', 'images', 'video', 'audio', 'plans', 'data', 'other']
    for (const t of types) {
      mkdirSync(join(assetsRoot, t, '_unlinked'), { recursive: true })
      mkdirSync(join(assetsRoot, t, 'library'), { recursive: true })
    }

    // Create test assets
    const taskDir = join(assetsRoot, 'images', 'task-abc')
    mkdirSync(taskDir, { recursive: true })
    writeFileSync(join(taskDir, 'hero.png'), 'fake-png')
    writeFileSync(join(taskDir, 'hero.png.meta.json'), JSON.stringify({
      agent: 'pixel',
      taskId: 'task-abc',
      created: '2026-03-23T10:00:00Z',
      tool: 'dall-e-3',
      description: 'Hero image',
      tags: ['hero', 'blog'],
    }))

    const textDir = join(assetsRoot, 'text', 'task-def')
    mkdirSync(textDir, { recursive: true })
    writeFileSync(join(textDir, 'post.md'), '# My Post')
    writeFileSync(join(textDir, 'post.md.meta.json'), JSON.stringify({
      agent: 'chef',
      taskId: 'task-def',
      created: '2026-03-23T12:00:00Z',
      description: 'Blog post draft',
      tags: ['blog', 'draft'],
    }))

    const videoDir = join(assetsRoot, 'video', 'task-ghi')
    mkdirSync(videoDir, { recursive: true })
    writeFileSync(join(videoDir, 'intro.mp4'), 'fake-video')
    writeFileSync(join(videoDir, 'intro.mp4.meta.json'), JSON.stringify({
      agent: 'rolo',
      taskId: 'task-ghi',
      created: '2026-03-23T08:00:00Z',
      tool: 'runway',
      description: 'Intro clip',
      tags: ['intro'],
    }))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    clearResolver()
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
      // Most recent first
      expect(all[0].metadata.agent).toBe('chef') // 12:00
      expect(all[1].metadata.agent).toBe('pixel') // 10:00
      expect(all[2].metadata.agent).toBe('rolo')  // 08:00
    })

    it('filters by type', () => {
      buildIndex()
      const images = listAssets({ type: 'images' })
      expect(images).toHaveLength(1)
      expect(images[0].filename).toBe('hero.png')
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
      expect(taskAssets[0].filename).toBe('post.md')
    })

    it('filters by tag', () => {
      buildIndex()
      const blogAssets = listAssets({ tag: 'blog' })
      expect(blogAssets).toHaveLength(2) // hero.png and post.md both tagged 'blog'
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
      const asset = getAsset('assets/images/task-abc/hero.png')
      expect(asset).toBeDefined()
      expect(asset!.filename).toBe('hero.png')
      expect(asset!.type).toBe('images')
      expect(asset!.mimeType).toBe('image/png')
    })

    it('returns undefined for nonexistent path', () => {
      buildIndex()
      expect(getAsset('assets/images/nope/nope.png')).toBeUndefined()
    })
  })

  describe('upsertAsset', () => {
    it('adds a new asset to the index', () => {
      buildIndex()
      expect(getCount()).toBe(3)

      // Add a new asset
      const newDir = join(assetsRoot, 'audio', 'task-jkl')
      mkdirSync(newDir, { recursive: true })
      writeFileSync(join(newDir, 'voice.mp3'), 'audio-data')
      writeFileSync(join(newDir, 'voice.mp3.meta.json'), JSON.stringify({
        agent: 'rolo',
        taskId: 'task-jkl',
        created: '2026-03-23T15:00:00Z',
      }))

      const asset = upsertAsset('assets/audio/task-jkl/voice.mp3')
      expect(asset).not.toBeNull()
      expect(asset!.filename).toBe('voice.mp3')
      expect(getCount()).toBe(4)
    })

    it('creates a stub sidecar if none exists', () => {
      buildIndex()
      const newDir = join(assetsRoot, 'images', 'task-xyz')
      mkdirSync(newDir, { recursive: true })
      writeFileSync(join(newDir, 'orphan.png'), 'data')

      const asset = upsertAsset('assets/images/task-xyz/orphan.png')
      expect(asset).not.toBeNull()
      expect(asset!.metadata.agent).toBe('unknown')
      expect(existsSync(join(newDir, 'orphan.png.meta.json'))).toBe(true)
    })
  })

  describe('removeAsset', () => {
    it('removes an asset from the index', () => {
      buildIndex()
      expect(getCount()).toBe(3)

      removeAsset('assets/images/task-abc/hero.png')
      expect(getCount()).toBe(2)
      expect(getAsset('assets/images/task-abc/hero.png')).toBeUndefined()
    })
  })

  describe('filename resolver integration', () => {
    it('buildIndex populates the filename resolver for primaries', () => {
      buildIndex()
      expect(resolveFilename('hero.png')).toBe('assets/images/task-abc/hero.png')
      expect(resolveFilename('post.md')).toBe('assets/text/task-def/post.md')
      expect(resolveFilename('intro.mp4')).toBe('assets/video/task-ghi/intro.mp4')
    })

    it('upsertAsset updates the resolver', () => {
      buildIndex()
      const newDir = join(assetsRoot, 'audio', 'task-jkl')
      mkdirSync(newDir, { recursive: true })
      writeFileSync(join(newDir, 'voice.mp3'), 'data')
      writeFileSync(join(newDir, 'voice.mp3.meta.json'), JSON.stringify({
        agent: 'rolo', taskId: 'task-jkl', created: '2026-03-23T15:00:00Z',
      }))
      upsertAsset('assets/audio/task-jkl/voice.mp3')
      expect(resolveFilename('voice.mp3')).toBe('assets/audio/task-jkl/voice.mp3')
    })

    it('removeAsset drops the resolver entry', () => {
      buildIndex()
      expect(resolveFilename('hero.png')).not.toBeNull()
      removeAsset('assets/images/task-abc/hero.png')
      expect(resolveFilename('hero.png')).toBeNull()
    })

    it('registers variant filenames in the resolver (they move with primaries)', () => {
      const taskDir = join(assetsRoot, 'images', 'task-abc')
      writeFileSync(join(taskDir, 'hero.thumb.jpg'), 'thumb')
      writeFileSync(join(taskDir, 'hero.thumb.jpg.meta.json'), JSON.stringify({
        agent: 'unknown', taskId: 'task-abc', created: '2026-03-23T10:00:01Z',
      }))
      buildIndex()
      expect(resolveFilename('hero.png')).toBe('assets/images/task-abc/hero.png')
      expect(resolveFilename('hero.thumb.jpg')).toBe('assets/images/task-abc/hero.thumb.jpg')
      // 3 primaries + 1 variant
      expect(resolverSize()).toBe(4)
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
      // Add a thumbnail for the existing hero.png
      const taskDir = join(assetsRoot, 'images', 'task-abc')
      writeFileSync(join(taskDir, 'hero.thumb.jpg'), 'thumb-data')
      writeFileSync(join(taskDir, 'hero.thumb.jpg.meta.json'), JSON.stringify({
        agent: 'unknown',
        taskId: 'task-abc',
        created: '2026-03-23T10:00:01Z',
      }))

      buildIndex()
      const groups = listGroupedAssets({ type: 'images' })

      expect(groups).toHaveLength(1)
      expect(groups[0].primary.filename).toBe('hero.png')
      expect(groups[0].variants).toHaveLength(1)
      expect(groups[0].variants[0].role).toBe('thumbnail')
      expect(groups[0].variants[0].asset.filename).toBe('hero.thumb.jpg')
    })

    it('returns assets without variants as groups with empty variants array', () => {
      buildIndex()
      const groups = listGroupedAssets({ type: 'text' })

      expect(groups).toHaveLength(1)
      expect(groups[0].primary.filename).toBe('post.md')
      expect(groups[0].variants).toHaveLength(0)
    })

    it('does not include variant files as separate primary entries', () => {
      const taskDir = join(assetsRoot, 'images', 'task-abc')
      writeFileSync(join(taskDir, 'hero.thumb.jpg'), 'thumb-data')

      buildIndex()

      // Flat list includes both
      const flat = listAssets({ type: 'images' })
      expect(flat).toHaveLength(2)

      // Grouped list shows only the primary
      const groups = listGroupedAssets({ type: 'images' })
      expect(groups).toHaveLength(1)
      expect(groups[0].primary.filename).toBe('hero.png')
    })

    it('respects filters when grouping', () => {
      buildIndex()
      const groups = listGroupedAssets({ agent: 'pixel' })

      expect(groups).toHaveLength(1)
      expect(groups[0].primary.metadata.agent).toBe('pixel')
    })

    it('handles multiple assets with thumbnails in different task dirs', () => {
      // Add another image in a different task dir
      const task2Dir = join(assetsRoot, 'images', 'task-zzz')
      mkdirSync(task2Dir, { recursive: true })
      writeFileSync(join(task2Dir, 'banner.png'), 'banner-data')
      writeFileSync(join(task2Dir, 'banner.png.meta.json'), JSON.stringify({
        agent: 'pixel',
        taskId: 'task-zzz',
        created: '2026-03-23T14:00:00Z',
      }))
      writeFileSync(join(task2Dir, 'banner.thumb.jpg'), 'thumb-data')

      // And a thumbnail for hero
      const taskDir = join(assetsRoot, 'images', 'task-abc')
      writeFileSync(join(taskDir, 'hero.thumb.jpg'), 'thumb-data')

      buildIndex()
      const groups = listGroupedAssets({ type: 'images' })

      expect(groups).toHaveLength(2)
      // Each should have exactly one thumbnail variant
      for (const g of groups) {
        expect(g.variants).toHaveLength(1)
        expect(g.variants[0].role).toBe('thumbnail')
      }
    })
  })
})
