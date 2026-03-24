import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock content-dir before importing asset-index
const testDir = join(tmpdir(), `beacon-test-index-${Date.now()}`)
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

import { buildIndex, upsertAsset, removeAsset, listAssets, getAsset, getCount } from '@mc/assets/lib/asset-index'

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
      agent: 'basil',
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
      expect(all[0].metadata.agent).toBe('basil') // 12:00
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
})
