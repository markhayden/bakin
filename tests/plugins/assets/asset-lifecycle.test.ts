/**
 * B3: versioned-asset lifecycle — addVersion, promote, deleteVersion (auto-
 * fallback / can't-delete-last / stable numbers), addExport (idempotent),
 * relink/retype, deleteAsset/restore. Isolated to a temp BAKIN_HOME.
 */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-asset-lifecycle-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import sharp from 'sharp'
import { assetDirRelPath } from '../../../plugins/assets/lib/asset-id'
import {
  createAsset, getAsset, addVersion, promoteVersion, deleteVersion,
  addExport, relink, retype, deleteAsset, restoreAsset,
} from '../../../plugins/assets/lib/asset-service'

const srcDir = join(testDir, 'src')
const png = (name: string, r: number) =>
  sharp({ create: { width: 6, height: 6, channels: 3, background: { r, g: 0, b: 0 } } }).png().toFile(join(srcDir, name))

async function freshImageAsset() {
  return createAsset({ sourceFilePath: join(srcDir, 'a.png'), type: 'images', agent: 'pixel', taskId: 't1', slug: 'pic', op: 'generate', description: 'first', tags: ['one'] })
}

beforeAll(async () => {
  mkdirSync(srcDir, { recursive: true })
  await png('a.png', 10)
  await png('b.png', 20)
})

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('addVersion + promote', () => {
  it('appends a version derived from current and advances the pointer', async () => {
    const { assetId } = await freshImageAsset()
    const r = await addVersion(assetId, { sourceFilePath: join(srcDir, 'b.png'), op: 'edit', description: 'second', tags: ['two'] })
    expect(r.version).toBe(2)
    const m = getAsset(assetId)!
    expect(m.currentVersion).toBe(2)
    expect(m.versions.map((v) => v.version)).toEqual([1, 2])
    expect(m.versions[1].parentVersion).toBe(1)
    expect(m.description).toBe('second') // mirrors current
    expect(m.tags).toEqual(['two'])
  })

  it('promote moves the pointer and restores that version display (mirror)', async () => {
    const { assetId } = await freshImageAsset()
    await addVersion(assetId, { sourceFilePath: join(srcDir, 'b.png'), description: 'second', tags: ['two'] })
    const m = await promoteVersion(assetId, 1)
    expect(m.currentVersion).toBe(1)
    expect(m.description).toBe('first')
    expect(m.tags).toEqual(['one'])
  })
})

describe('deleteVersion', () => {
  it('auto-falls-back to the highest remaining version when deleting current', async () => {
    const { assetId } = await freshImageAsset()
    await addVersion(assetId, { sourceFilePath: join(srcDir, 'b.png'), description: 'second' }) // v2 current
    const m = await deleteVersion(assetId, 2)
    expect(m.currentVersion).toBe(1)
    expect(m.versions.map((v) => v.version)).toEqual([1])
  })

  it('preserves stable numbers (gaps) when deleting a middle version', async () => {
    const { assetId } = await freshImageAsset()
    await addVersion(assetId, { sourceFilePath: join(srcDir, 'b.png') }) // v2
    await addVersion(assetId, { sourceFilePath: join(srcDir, 'a.png') }) // v3 current
    await deleteVersion(assetId, 2)
    const m = getAsset(assetId)!
    expect(m.versions.map((v) => v.version)).toEqual([1, 3])
    expect(m.currentVersion).toBe(3) // unaffected
  })

  it('refuses to delete the last remaining version', async () => {
    const { assetId } = await freshImageAsset()
    await expect(deleteVersion(assetId, 1)).rejects.toThrow(/last remaining/)
  })
})

describe('addExport', () => {
  it('renders an export keyed by surface and is idempotent (overwrites, no pile-up)', async () => {
    const { assetId } = await freshImageAsset()
    await addExport(assetId, { surface: 'open-graph', format: 'jpg', width: 120, height: 63 })
    let m = getAsset(assetId)!
    expect(m.exports).toHaveLength(1)
    expect(existsSync(join(testDir, assetDirRelPath(assetId)!, 'exports', 'open-graph.jpg'))).toBe(true)

    // Re-export same surface, different format → overwrites the single entry.
    await addExport(assetId, { surface: 'open-graph', format: 'png', width: 120, height: 63 })
    m = getAsset(assetId)!
    expect(m.exports).toHaveLength(1)
    expect(m.exports[0].format).toBe('png')
    expect(existsSync(join(testDir, assetDirRelPath(assetId)!, 'exports', 'open-graph.jpg'))).toBe(false) // stale removed

    // Different surface → second export.
    await addExport(assetId, { surface: 'square', format: 'jpg', width: 60, height: 60 })
    expect(getAsset(assetId)!.exports).toHaveLength(2)
  })
})

describe('relink / retype', () => {
  it('updates asset-level taskId and type', async () => {
    const { assetId } = await freshImageAsset()
    expect((await relink(assetId, 'task-99')).taskId).toBe('task-99')
    expect((await retype(assetId, 'other')).type).toBe('other')
  })
})

describe('deleteAsset / restoreAsset', () => {
  it('trashes the whole asset dir and restores it', async () => {
    const { assetId } = await freshImageAsset()
    const { trashName } = await deleteAsset(assetId)
    expect(getAsset(assetId)).toBeNull()
    expect(existsSync(join(testDir, assetDirRelPath(assetId)!))).toBe(false)
    const restored = await restoreAsset(trashName)
    expect(restored.assetId).toBe(assetId)
    expect(getAsset(assetId)?.assetId).toBe(assetId)
  })
})
