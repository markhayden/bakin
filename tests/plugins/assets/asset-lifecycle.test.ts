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
  addExport, relink, retype,
} from '../../../plugins/assets/lib/asset-service'
import { deleteAsset, restoreAsset } from '../../../plugins/assets/lib/asset-trash'

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
  // A wide 4:1 source for exercising export fit modes.
  await sharp({ create: { width: 40, height: 10, channels: 3, background: { r: 0, g: 0, b: 255 } } }).png().toFile(join(srcDir, 'wide.png'))
})

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('addVersion + promote', () => {
  it('appends a version derived from current and advances the pointer', async () => {
    const { assetId } = await freshImageAsset()
    const r = await addVersion(assetId, { sourceFilePath: join(srcDir, 'b.png'), op: 'edit', description: 'second' })
    expect(r.version).toBe(2)
    const m = getAsset(assetId)!
    expect(m.currentVersion).toBe(2)
    expect(m.versions.map((v) => v.version)).toEqual([1, 2])
    expect(m.versions[1].parentVersion).toBe(1)
    expect(m.description).toBe('second') // mirrors current
    expect(m.tags).toEqual(['one']) // tags are asset-level — versioning never touches them
  })

  it('promote moves the pointer and restores that version description, never tags', async () => {
    const { assetId } = await freshImageAsset()
    await addVersion(assetId, { sourceFilePath: join(srcDir, 'b.png'), description: 'second' })
    const m = await promoteVersion(assetId, 1)
    expect(m.currentVersion).toBe(1)
    expect(m.description).toBe('first')
    expect(m.tags).toEqual(['one'])
  })

  it('version objects carry no tags field (asset-level namespace only)', async () => {
    const { assetId } = await freshImageAsset()
    await addVersion(assetId, { sourceFilePath: join(srcDir, 'b.png'), description: 'second' })
    const m = getAsset(assetId)!
    for (const v of m.versions) expect('tags' in v).toBe(false)
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

  it("fit:'inside' preserves aspect ratio (no crop); default 'cover' fills the box", async () => {
    const { assetId } = await createAsset({
      sourceFilePath: join(srcDir, 'wide.png'), type: 'images', agent: 'pixel', taskId: 't1',
      slug: 'wide', op: 'generate', description: 'wide',
    })
    const exportPath = (surface: string, fmt: string) => join(testDir, assetDirRelPath(assetId)!, 'exports', `${surface}.${fmt}`)

    // Default 'cover' crops the 4:1 source to exactly the box.
    await addExport(assetId, { surface: 'cover-box', format: 'png', width: 20, height: 20 })
    const cover = await sharp(exportPath('cover-box', 'png')).metadata()
    expect([cover.width, cover.height]).toEqual([20, 20])

    // 'inside' scales the 4:1 source to fit within the box, preserving aspect (20x5), no crop.
    await addExport(assetId, { surface: 'inside-box', format: 'png', width: 20, height: 20, fit: 'inside' })
    const inside = await sharp(exportPath('inside-box', 'png')).metadata()
    expect([inside.width, inside.height]).toEqual([20, 5])
  })

  it('rejects unsafe format/dimensions/quality before touching disk', async () => {
    const { assetId } = await freshImageAsset()
    // format is appended to the on-disk path — a traversal/unknown format must throw.
    await expect(addExport(assetId, { surface: 'og', format: 'jpg/../../x' as 'jpg', width: 10, height: 10 })).rejects.toThrow(/Invalid export format/)
    await expect(addExport(assetId, { surface: 'og', format: 'gif' as 'jpg', width: 10, height: 10 })).rejects.toThrow(/Invalid export format/)
    // dimensions feed sharp.resize — reject non-positive / non-finite / oversized.
    await expect(addExport(assetId, { surface: 'og', format: 'jpg', width: 0, height: 10 })).rejects.toThrow(/Invalid export width/)
    await expect(addExport(assetId, { surface: 'og', format: 'jpg', width: 10, height: 99999 })).rejects.toThrow(/Invalid export height/)
    await expect(addExport(assetId, { surface: 'og', format: 'jpg', width: Number.NaN, height: 10 })).rejects.toThrow(/Invalid export width/)
    // quality is 1..100.
    await expect(addExport(assetId, { surface: 'og', format: 'jpg', width: 10, height: 10, quality: 0 })).rejects.toThrow(/Invalid export quality/)
    await expect(addExport(assetId, { surface: 'og', format: 'jpg', width: 10, height: 10, quality: 101 })).rejects.toThrow(/Invalid export quality/)
    // No export was written despite the rejected calls.
    expect(getAsset(assetId)!.exports).toHaveLength(0)
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
