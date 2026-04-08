/**
 * Tests for asset relink/unlink — relinkAsset() in plugins/assets/lib/relink.ts.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-relink-${Date.now()}`)

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
      'assets.data': join(base, 'data'),
      'assets.other': join(base, 'other'),
    }
  },
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { relinkAsset } from '@bakin/assets/lib/relink'

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function createAssetFixture(type: string, taskId: string, filename: string, content = 'test') {
  const dir = join(testDir, 'assets', type, taskId)
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, filename)
  writeFileSync(filePath, content)
  writeFileSync(filePath + '.meta.json', JSON.stringify({
    agent: 'user',
    taskId,
    created: new Date().toISOString(),
  }))
  return `assets/${type}/${taskId}/${filename}`
}

describe('relinkAsset', () => {
  it('moves asset from one task to another', () => {
    const path = createAssetFixture('images', 'task-a', '20260404-photo.png')
    const result = relinkAsset({ assetPath: path, newTaskId: 'task-b' })

    expect(result.ok).toBe(true)
    expect(result.newPath).toBe('assets/images/task-b/20260404-photo.png')

    // Old file should be gone
    expect(existsSync(join(testDir, path))).toBe(false)
    // New file should exist
    expect(existsSync(join(testDir, result.newPath!))).toBe(true)
    // Sidecar should exist at new location
    expect(existsSync(join(testDir, result.newPath! + '.meta.json'))).toBe(true)
  })

  it('unlinks asset to _unlinked directory', () => {
    const path = createAssetFixture('text', 'task-c', '20260404-notes.md')
    const result = relinkAsset({ assetPath: path, newTaskId: null })

    expect(result.ok).toBe(true)
    expect(result.newPath).toBe('assets/text/_unlinked/20260404-notes.md')
    expect(existsSync(join(testDir, result.newPath!))).toBe(true)

    // Sidecar should have taskId: null
    const sidecar = JSON.parse(readFileSync(join(testDir, result.newPath! + '.meta.json'), 'utf-8'))
    expect(sidecar.taskId).toBeNull()
  })

  it('updates sidecar taskId after relink', () => {
    const path = createAssetFixture('images', 'task-d', '20260404-ref.png')
    const result = relinkAsset({ assetPath: path, newTaskId: 'task-e' })

    expect(result.ok).toBe(true)
    const sidecar = JSON.parse(readFileSync(join(testDir, result.newPath! + '.meta.json'), 'utf-8'))
    expect(sidecar.taskId).toBe('task-e')
  })

  it('returns no-op when relinking to same task', () => {
    const path = createAssetFixture('text', 'task-f', '20260404-same.md')
    const result = relinkAsset({ assetPath: path, newTaskId: 'task-f' })

    expect(result.ok).toBe(true)
    expect(result.newPath).toBe(path)
    // File should still exist
    expect(existsSync(join(testDir, path))).toBe(true)
  })

  it('rejects path traversal', () => {
    const result = relinkAsset({ assetPath: 'assets/../etc/passwd', newTaskId: 'task-x' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('..')
  })

  it('rejects invalid path prefix', () => {
    const result = relinkAsset({ assetPath: 'not-assets/foo/bar/file.png', newTaskId: 'task-x' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('must start with assets/')
  })

  it('returns error for non-existent asset', () => {
    const result = relinkAsset({ assetPath: 'assets/images/ghost/20260404-nope.png', newTaskId: 'task-x' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('handles filename collision in target directory', () => {
    const path = createAssetFixture('images', 'task-g', '20260404-dup.png')
    // Pre-create a file at the target location
    const targetDir = join(testDir, 'assets', 'images', 'task-h')
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(targetDir, '20260404-dup.png'), 'existing')

    const result = relinkAsset({ assetPath: path, newTaskId: 'task-h' })

    expect(result.ok).toBe(true)
    // Should have a modified filename (with random suffix)
    expect(result.newPath).not.toBe('assets/images/task-h/20260404-dup.png')
    expect(result.newPath).toContain('assets/images/task-h/20260404-dup-')
    expect(existsSync(join(testDir, result.newPath!))).toBe(true)
  })

  it('moves variants (.thumb.*) along with the primary file', () => {
    const path = createAssetFixture('images', 'task-i', '20260404-hero.png')
    // Create a thumbnail variant
    const thumbPath = join(testDir, 'assets', 'images', 'task-i', '20260404-hero.thumb.jpg')
    writeFileSync(thumbPath, 'thumb-data')

    const result = relinkAsset({ assetPath: path, newTaskId: 'task-j' })

    expect(result.ok).toBe(true)
    // Thumbnail should have moved too
    expect(existsSync(join(testDir, 'assets', 'images', 'task-j', '20260404-hero.thumb.jpg'))).toBe(true)
    expect(existsSync(thumbPath)).toBe(false)
  })
})
