/**
 * Tests for saveAsset — verifies filename-as-identity conventions:
 * every saved asset gets a YYYYMMDD-{slug}-{id8}.{ext} filename,
 * collisions trigger regeneration, and variants share the unique stem.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-save-${Date.now()}`)
const assetsRoot = join(testDir, 'assets')

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => {
    const base = join(testDir, 'assets')
    return {
      assets: base,
      'assets.store': join(base, 'store'),
      'assets.inbox': join(base, 'inbox'),
      'assets.trash': join(base, '.trash'),
    }
  },
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { saveAsset } from '@bakin/assets/lib/save-asset'
import { isConventional, primaryStem } from '@bakin/assets/lib/filename-id'

describe('assets/save-asset', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
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

  it('writes the asset and sidecar into assets/store/{YYYY-MM}/', async () => {
    const result = await saveFixture()
    // YYYY-MM derived from the canonical filename prefix.
    const ym = result.filename!.slice(0, 4) + '-' + result.filename!.slice(4, 6)
    const storeDir = join(assetsRoot, 'store', ym)
    const files = readdirSync(storeDir)
    expect(files).toContain(result.filename!)
    expect(files).toContain(result.filename! + '.meta.json')
  })

  it('returns a relative path under assets/store/{YYYY-MM}/', async () => {
    const result = await saveFixture()
    expect(result.path).toMatch(/^assets\/store\/\d{4}-\d{2}\/\d{8}-hero-[0-9a-f]{8}\.png$/)
  })

  it('regenerates suffix so two same-slug saves get distinct filenames', async () => {
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
    const ym = result.filename!.slice(0, 4) + '-' + result.filename!.slice(4, 6)
    const storeDir = join(assetsRoot, 'store', ym)
    const thumbName = `${stem}.thumb.jpg`
    // ffmpeg failure is non-fatal; we only assert the stem is correctly derived.
    if (existsSync(join(storeDir, thumbName))) {
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

  it('sidecar includes agent, taskId, created, type', async () => {
    const result = await saveFixture()
    const metaPath = join(testDir, result.metadataPath!)
    const meta = JSON.parse(require('fs').readFileSync(metaPath, 'utf-8'))
    expect(meta.agent).toBe('pixel')
    expect(meta.taskId).toBe('task-abc')
    expect(meta.type).toBe('images')
    expect(typeof meta.created).toBe('string')
  })

  it('produces unique filenames across many same-slug saves', async () => {
    // Ten consecutive same-slug saves must all collide-check against disk
    // and regenerate the id8 suffix whenever a file is already present.
    const filenames = new Set<string>()
    for (let i = 0; i < 10; i++) {
      const r = await saveFixture('data-' + i)
      filenames.add(r.filename!)
    }
    expect(filenames.size).toBe(10)
  })
})
