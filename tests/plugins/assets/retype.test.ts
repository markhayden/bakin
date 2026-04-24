/**
 * Tests for asset retype — retypeAsset() in plugins/assets/lib/retype.ts.
 *
 * Under filename-as-identity, retype is a sidecar-only edit: the file
 * stays at its on-disk path (assets/store/{YYYY-MM}/{filename}) and only
 * `sidecar.type` changes.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-retype-${Date.now()}`)

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

import { retypeAsset } from '@bakin/assets/lib/retype'
import { pathForFilename } from '@bakin/assets/lib/path-for-filename'

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function createAssetFixture(filename: string, type = 'images', content = 'bytes') {
  const rel = pathForFilename(filename)!
  const abs = join(testDir, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
  writeFileSync(`${abs}.meta.json`, JSON.stringify({
    agent: 'user',
    taskId: 'task-1',
    created: new Date().toISOString(),
    type,
  }))
  return rel
}

describe('retypeAsset (metadata-only)', () => {
  it('updates sidecar type without moving the file', () => {
    const rel = createAssetFixture('20260404-note-aaaa1111.md', 'text')
    const abs = join(testDir, rel)
    const inoBefore = statSync(abs).ino

    const result = retypeAsset({ filename: '20260404-note-aaaa1111.md', newType: 'research' })

    expect(result.ok).toBe(true)
    expect(result.filename).toBe('20260404-note-aaaa1111.md')
    expect(result.newType).toBe('research')
    expect(result.path).toBe(rel)

    // Identity check — same inode proves no move occurred.
    expect(existsSync(abs)).toBe(true)
    expect(statSync(abs).ino).toBe(inoBefore)

    const sidecar = JSON.parse(readFileSync(abs + '.meta.json', 'utf-8'))
    expect(sidecar.type).toBe('research')
  })

  it('is a no-op when retyping to the same type', () => {
    const rel = createAssetFixture('20260404-same-bbbb2222.png', 'images')
    const abs = join(testDir, rel)
    const mtimeBefore = statSync(abs + '.meta.json').mtimeMs

    const result = retypeAsset({ filename: '20260404-same-bbbb2222.png', newType: 'images' })

    expect(result.ok).toBe(true)
    expect(result.path).toBe(rel)

    // Sidecar not rewritten when the value is already correct.
    expect(statSync(abs + '.meta.json').mtimeMs).toBe(mtimeBefore)
  })

  it('rejects invalid types', () => {
    createAssetFixture('20260404-bad-cccc3333.png', 'images')
    const result = retypeAsset({
      filename: '20260404-bad-cccc3333.png',
      newType: 'not-a-real-type' as never,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Invalid type')
  })

  it('rejects non-canonical filenames', () => {
    const result = retypeAsset({ filename: 'not-canonical.png', newType: 'images' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Non-canonical')
  })

  it('returns "Asset not found" when the file is missing on disk', () => {
    const result = retypeAsset({ filename: '20260404-ghost-ffffffff.png', newType: 'images' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('rejects empty filename', () => {
    const result = retypeAsset({ filename: '', newType: 'images' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Missing')
  })
})
