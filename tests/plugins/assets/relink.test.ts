/**
 * Tests for asset relink/unlink — relinkAsset() in plugins/assets/lib/relink.ts.
 *
 * Under filename-as-identity, relink is a sidecar-only edit: the file stays
 * at its on-disk path and only `sidecar.taskId` changes.
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
      'assets.research': join(base, 'research'),
      'assets.pdf': join(base, 'pdf'),
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
import { setFilename, clearResolver } from '@bakin/assets/lib/resolver'

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  clearResolver()
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
    type,
  }))
  const rel = `assets/${type}/${taskId}/${filename}`
  setFilename(filename, rel)
  return rel
}

describe('relinkAsset (metadata-only)', () => {
  it('updates sidecar taskId without moving the file', () => {
    const rel = createAssetFixture('images', 'task-a', '20260404-photo-a1b2c3d4.png')
    const result = relinkAsset({ filename: '20260404-photo-a1b2c3d4.png', newTaskId: 'task-b' })

    expect(result.ok).toBe(true)
    expect(result.filename).toBe('20260404-photo-a1b2c3d4.png')
    expect(result.newTaskId).toBe('task-b')
    expect(result.path).toBe(rel)

    // File is still at its original location — no move occurred.
    expect(existsSync(join(testDir, rel))).toBe(true)
    expect(existsSync(join(testDir, rel + '.meta.json'))).toBe(true)

    // Sidecar taskId was updated.
    const sidecar = JSON.parse(readFileSync(join(testDir, rel + '.meta.json'), 'utf-8'))
    expect(sidecar.taskId).toBe('task-b')
  })

  it('unlink sets sidecar taskId to null without moving the file', () => {
    const rel = createAssetFixture('text', 'task-c', '20260404-notes-deadbeef.md')
    const result = relinkAsset({ filename: '20260404-notes-deadbeef.md', newTaskId: null })

    expect(result.ok).toBe(true)
    expect(result.newTaskId).toBeNull()

    // File stays put.
    expect(existsSync(join(testDir, rel))).toBe(true)
    const sidecar = JSON.parse(readFileSync(join(testDir, rel + '.meta.json'), 'utf-8'))
    expect(sidecar.taskId).toBeNull()
  })

  it('is a no-op when relinking to the same task', () => {
    const rel = createAssetFixture('text', 'task-f', '20260404-same-abcd1234.md')
    const result = relinkAsset({ filename: '20260404-same-abcd1234.md', newTaskId: 'task-f' })

    expect(result.ok).toBe(true)
    expect(result.path).toBe(rel)
    expect(existsSync(join(testDir, rel))).toBe(true)
  })

  it('rejects taskIds that contain path separators', () => {
    createAssetFixture('images', 'task-x', '20260404-sep-aaaabbbb.png')
    const result = relinkAsset({ filename: '20260404-sep-aaaabbbb.png', newTaskId: '../../etc' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('path separators')
  })

  it('returns "Asset not found" when the filename is unknown to the resolver', () => {
    const result = relinkAsset({ filename: '20260404-ghost-ffffffff.png', newTaskId: 'task-x' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('returns "Asset not found" when the file is missing on disk even if registered', () => {
    setFilename('20260404-stale-12345678.md', 'assets/text/gone/20260404-stale-12345678.md')
    const result = relinkAsset({ filename: '20260404-stale-12345678.md', newTaskId: 'task-z' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not found')
  })
})
