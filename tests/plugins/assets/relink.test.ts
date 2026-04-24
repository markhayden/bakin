/**
 * Tests for asset relink/unlink — relinkAsset() in plugins/assets/lib/relink.ts.
 *
 * Under filename-as-identity, relink is a sidecar-only edit: the file stays
 * at its on-disk path (assets/store/{YYYY-MM}/{filename}) and only
 * `sidecar.taskId` changes.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-relink-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

import { relinkAsset } from '@bakin/assets/lib/relink'
import { pathForFilename } from '@bakin/assets/lib/path-for-filename'

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function createAssetFixture(filename: string, taskId: string, type = 'images', content = 'test') {
  const rel = pathForFilename(filename)!
  const abs = join(testDir, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
  writeFileSync(`${abs}.meta.json`, JSON.stringify({
    agent: 'user',
    taskId,
    created: new Date().toISOString(),
    type,
  }))
  return rel
}

describe('relinkAsset (metadata-only)', () => {
  it('updates sidecar taskId without moving the file', () => {
    const rel = createAssetFixture('20260404-photo-a1b2c3d4.png', 'task-a')
    const result = relinkAsset({ filename: '20260404-photo-a1b2c3d4.png', newTaskId: 'task-b' })

    expect(result.ok).toBe(true)
    expect(result.filename).toBe('20260404-photo-a1b2c3d4.png')
    expect(result.newTaskId).toBe('task-b')
    expect(result.path).toBe(rel)

    expect(existsSync(join(testDir, rel))).toBe(true)
    expect(existsSync(join(testDir, rel + '.meta.json'))).toBe(true)

    const sidecar = JSON.parse(readFileSync(join(testDir, rel + '.meta.json'), 'utf-8'))
    expect(sidecar.taskId).toBe('task-b')
  })

  it('unlink sets sidecar taskId to null without moving the file', () => {
    const rel = createAssetFixture('20260404-notes-deadbeef.md', 'task-c', 'text')
    const result = relinkAsset({ filename: '20260404-notes-deadbeef.md', newTaskId: null })

    expect(result.ok).toBe(true)
    expect(result.newTaskId).toBeNull()

    expect(existsSync(join(testDir, rel))).toBe(true)
    const sidecar = JSON.parse(readFileSync(join(testDir, rel + '.meta.json'), 'utf-8'))
    expect(sidecar.taskId).toBeNull()
  })

  it('is a no-op when relinking to the same task', () => {
    const rel = createAssetFixture('20260404-same-abcd1234.md', 'task-f', 'text')
    const result = relinkAsset({ filename: '20260404-same-abcd1234.md', newTaskId: 'task-f' })

    expect(result.ok).toBe(true)
    expect(result.path).toBe(rel)
    expect(existsSync(join(testDir, rel))).toBe(true)
  })

  it('rejects taskIds that contain path separators', () => {
    createAssetFixture('20260404-sep-aaaabbbb.png', 'task-x')
    const result = relinkAsset({ filename: '20260404-sep-aaaabbbb.png', newTaskId: '../../etc' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('path separators')
  })

  it('returns "Asset not found" when the file is missing on disk', () => {
    const result = relinkAsset({ filename: '20260404-ghost-ffffffff.png', newTaskId: 'task-x' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('rejects non-canonical filenames', () => {
    const result = relinkAsset({ filename: 'not-canonical.png', newTaskId: 'task-z' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Non-canonical')
  })
})
