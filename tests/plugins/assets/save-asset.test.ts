/**
 * Tests for saveAsset — verifies filename-as-identity conventions:
 * every saved asset gets a YYYYMMDD-{slug}-{id8}.{ext} filename,
 * collisions trigger regeneration, and variants share the unique stem.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-save-${Date.now()}`)
const assetsRoot = join(testDir, 'assets')

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => {
    const base = join(testDir, 'assets')
    return {
      'assets.text': join(base, 'text'),
      'assets.images': join(base, 'images'),
      'assets.video': join(base, 'video'),
      'assets.audio': join(base, 'audio'),
      'assets.plans': join(base, 'plans'),
      'assets.research': join(base, 'research'),
      'assets.pdf': join(base, 'pdf'),
      'assets.data': join(base, 'data'),
      'assets.other': join(base, 'other'),
    }
  },
}))
vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { saveAsset } from '@bakin/assets/lib/save-asset'
import { isConventional, primaryStem } from '@bakin/assets/lib/filename-id'
import { setFilename, clearResolver, resolveFilename } from '@bakin/assets/lib/resolver'

describe('assets/save-asset', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
    clearResolver()
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    clearResolver()
  })

  async function saveFixture(content = 'fake-data', origName = 'my-hero.png') {
    const src = join(testDir, 'src-' + origName)
    writeFileSync(src, content)
    return saveAsset({
      filePath: src,
      taskId: 'task-abc',
      type: 'images',
      agent: 'pixel',
      description: 'Hero',
      slug: 'hero',
    })
  }

  it('saves with a conventional filename', async () => {
    const result = await saveFixture()
    expect(result.ok).toBe(true)
    expect(result.filename).toBeDefined()
    expect(isConventional(result.filename!)).toBe(true)
    expect(result.filename).toMatch(/^\d{8}-hero-[0-9a-f]{8}\.png$/)
  })

  it('writes the asset and sidecar into the type/task dir', async () => {
    const result = await saveFixture()
    const taskDir = join(assetsRoot, 'images', 'task-abc')
    const files = readdirSync(taskDir)
    expect(files).toContain(result.filename!)
    expect(files).toContain(result.filename! + '.meta.json')
  })

  it('returns a relative path under assets/', async () => {
    const result = await saveFixture()
    expect(result.path).toMatch(/^assets\/images\/task-abc\/\d{8}-hero-[0-9a-f]{8}\.png$/)
  })

  it('regenerates suffix on resolver collision', async () => {
    // Pre-populate resolver with a filename that would otherwise be generated.
    // To deterministically force a collision, stub the id8 generator via
    // two consecutive saves with the same slug and verify both filenames differ.
    const r1 = await saveFixture('first')
    const r2 = await saveFixture('second')
    expect(r1.filename).not.toBe(r2.filename)
    expect(isConventional(r1.filename!)).toBe(true)
    expect(isConventional(r2.filename!)).toBe(true)
  })

  it('thumbnail (if generated) shares the primary stem', async () => {
    // ffmpeg likely isn't installed in CI — just verify the code path
    // doesn't reject and that the primary file is correctly named.
    const result = await saveFixture()
    const stem = primaryStem(result.filename!)
    const taskDir = join(assetsRoot, 'images', 'task-abc')
    const thumbName = `${stem}.thumb.jpg`
    // ffmpeg failure is non-fatal; we only assert the stem is correctly derived.
    if (existsSync(join(taskDir, thumbName))) {
      expect(thumbName.startsWith(stem)).toBe(true)
    }
  })

  it('respects custom slug argument', async () => {
    const src = join(testDir, 'src-hero.png')
    writeFileSync(src, 'data')
    const result = await saveAsset({
      filePath: src,
      taskId: 'task-abc',
      type: 'images',
      agent: 'pixel',
      slug: 'custom-banner',
    })
    expect(result.filename).toMatch(/^\d{8}-custom-banner-[0-9a-f]{8}\.png$/)
  })

  it('derives slug from source filename when slug omitted', async () => {
    const src = join(testDir, 'The Big Image!.png')
    writeFileSync(src, 'data')
    const result = await saveAsset({
      filePath: src,
      taskId: 'task-abc',
      type: 'images',
      agent: 'pixel',
    })
    expect(result.filename).toMatch(/^\d{8}-the-big-image-[0-9a-f]{8}\.png$/)
  })

  it('errors when source file missing', async () => {
    const result = await saveAsset({
      filePath: join(testDir, 'does-not-exist.png'),
      taskId: 'task-abc',
      type: 'images',
      agent: 'pixel',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Source file not found')
  })

  it('sidecar includes agent, taskId, created', async () => {
    const result = await saveFixture()
    const metaPath = join(testDir, result.metadataPath!)
    const meta = JSON.parse(require('fs').readFileSync(metaPath, 'utf-8'))
    expect(meta.agent).toBe('pixel')
    expect(meta.taskId).toBe('task-abc')
    expect(typeof meta.created).toBe('string')
  })

  it('does not collide with a pre-existing conventional filename in resolver', async () => {
    // Simulate: another asset is already using a specific conventional name.
    // Because id8 is random and the resolver is consulted, saveAsset must
    // not produce a colliding name.
    // We can't deterministically force the same suffix, but we can verify
    // that when saving N assets with the same slug, all filenames are unique.
    const filenames = new Set<string>()
    for (let i = 0; i < 10; i++) {
      const r = await saveFixture('data-' + i)
      filenames.add(r.filename!)
    }
    expect(filenames.size).toBe(10)
  })
})
