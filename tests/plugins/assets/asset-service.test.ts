/**
 * Versioned asset service foundation (B1): assetId, per-asset lock, atomic
 * manifest IO, and create/read service. Isolated to a temp BAKIN_HOME so it
 * never touches ~/.bakin.
 */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-asset-svc-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import sharp from 'sharp'
import { generateAssetId, yearMonthFromAssetId, isValidAssetId, assetDirRelPath } from '../../../plugins/assets/lib/asset-id'
import { withAssetLock } from '../../../plugins/assets/lib/asset-lock'
import { readManifest, writeManifestAtomic, type AssetManifest } from '../../../plugins/assets/lib/manifest'
import { createAsset, getAsset, resolveFile, assetExists, listAssets } from '../../../plugins/assets/lib/asset-service'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const srcDir = join(testDir, 'src')

beforeAll(async () => {
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'note.md'), '# hello\nworld\n', 'utf-8')
  await sharp({ create: { width: 8, height: 6, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .png()
    .toFile(join(srcDir, 'pic.png'))
})

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('asset-id', () => {
  it('generates YYYYMMDD-slug-id8 and derives the shard', () => {
    const id = generateAssetId('Ice Cream Sandwich!')
    expect(id).toMatch(/^\d{8}-ice-cream-sandwich-[0-9a-f]{8}$/)
    expect(yearMonthFromAssetId(id)).toMatch(/^\d{4}-\d{2}$/)
    expect(assetDirRelPath(id)).toBe(`assets/store/${yearMonthFromAssetId(id)}/${id}`)
  })

  it('rejects unsafe / non-conforming ids', () => {
    expect(isValidAssetId('20260529-x-aabbccdd')).toBe(true)
    expect(isValidAssetId('../escape-aabbccdd')).toBe(false)
    expect(isValidAssetId('a/b-aabbccdd')).toBe(false)
    expect(isValidAssetId('not-an-id')).toBe(false)
    expect(yearMonthFromAssetId('20261301-x-aabbccdd')).toBeNull() // bad month
  })
})

describe('withAssetLock', () => {
  it('serializes operations on the same assetId', async () => {
    const order: string[] = []
    const op = (label: string, ms: number) =>
      withAssetLock('a', async () => { order.push(`${label}-start`); await delay(ms); order.push(`${label}-end`) })
    await Promise.all([op('1', 25), op('2', 5)])
    expect(order).toEqual(['1-start', '1-end', '2-start', '2-end'])
  })

  it('allows operations on different assetIds to overlap', async () => {
    const order: string[] = []
    const op = (id: string, label: string, ms: number) =>
      withAssetLock(id, async () => { order.push(`${label}-start`); await delay(ms); order.push(`${label}-end`) })
    await Promise.all([op('x', 'x', 25), op('y', 'y', 5)])
    // y must start before x finishes — proving concurrency across ids
    expect(order.indexOf('y-start')).toBeLessThan(order.indexOf('x-end'))
  })
})

describe('manifest atomic IO', () => {
  const dir = join(testDir, 'mtest')
  const manifest: AssetManifest = {
    assetId: '20260529-m-aabbccdd', type: 'text', source: { kind: 'upload', path: null },
    agent: 'tester', taskId: null, created: 'c', updated: 'c', currentVersion: 1,
    description: 'd', tags: ['t'],
    versions: [{ version: 1, file: 'v1.md', thumb: null, mimeType: 'text/markdown', size: 3, width: null, height: null, created: 'c', description: 'd', op: 'upload', parentVersion: null, tool: null, prompt: null, promptHash: null, generation: null }],
    exports: [],
  }

  beforeAll(() => mkdirSync(dir, { recursive: true }))

  it('round-trips and leaves no temp files', () => {
    writeManifestAtomic(dir, manifest)
    expect(readManifest(dir)).toEqual(manifest)
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('returns null for a missing or invalid manifest', () => {
    expect(readManifest(join(testDir, 'nope'))).toBeNull()
    const bad = join(testDir, 'bad'); mkdirSync(bad, { recursive: true })
    writeFileSync(join(bad, 'manifest.json'), '{ not valid', 'utf-8')
    expect(readManifest(bad)).toBeNull()
  })
})

describe('asset-service create + read', () => {
  it('creates a text asset (v1) and reads it back', async () => {
    const { assetId, version, manifest } = await createAsset({
      sourceFilePath: join(srcDir, 'note.md'), type: 'text', agent: 'tester', taskId: 'task-1',
      slug: 'my note', op: 'upload', description: 'a note',
    })
    expect(version).toBe(1)
    expect(manifest.currentVersion).toBe(1)
    expect(manifest.versions[0].file).toBe('v1.md')
    const dirAbs = join(testDir, assetDirRelPath(assetId)!)
    expect(existsSync(join(dirAbs, 'v1.md'))).toBe(true)
    expect(existsSync(join(dirAbs, 'manifest.json'))).toBe(true)
    expect(getAsset(assetId)?.assetId).toBe(assetId)
    expect(assetExists(assetId)).toBe(true)
    expect(assetExists('20260529-ghost-deadbeef')).toBe(false)
  })

  it('creates an image asset with probed dimensions', async () => {
    const { assetId, manifest } = await createAsset({
      sourceFilePath: join(srcDir, 'pic.png'), type: 'images', agent: 'pixel', taskId: 'task-2',
      slug: 'pic', op: 'generate',
    })
    expect(manifest.versions[0].mimeType).toBe('image/png')
    expect(manifest.versions[0].width).toBe(8)
    expect(manifest.versions[0].height).toBe(6)
    expect(manifest.versions[0].thumb).toBe('v1.thumb.jpg')
    const ref = resolveFile(assetId)
    expect(ref?.version).toBe(1)
    expect(ref?.absPath.endsWith('v1.png')).toBe(true)
    expect(existsSync(join(testDir, assetDirRelPath(assetId)!, 'v1.thumb.jpg'))).toBe(true)
    expect(resolveFile(assetId, 99)).toBeNull()
  })

  it('lists assets with current-version view and filters', async () => {
    const all = listAssets()
    expect(all.length).toBeGreaterThanOrEqual(2)
    expect(all.every((a) => a.versionCount === 1)).toBe(true)
    expect(listAssets({ type: 'images' }).every((a) => a.type === 'images')).toBe(true)
    expect(listAssets({ taskId: 'task-1' }).every((a) => a.taskId === 'task-1')).toBe(true)
  })

  it('filters by tag with AND semantics (the UI "folders", #418)', async () => {
    await createAsset({
      sourceFilePath: join(srcDir, 'pic.png'), type: 'images', agent: 'pixel', taskId: 'task-brand',
      slug: 'brand-hero', op: 'generate', tags: ['Brand', 'hero'],
    })
    // Single tag, normalized (Brand → brand).
    const brand = listAssets({ tags: ['brand'] })
    expect(brand.length).toBe(1)
    expect(brand[0].tags).toEqual(expect.arrayContaining(['brand', 'hero']))
    // AND: must carry every requested tag.
    expect(listAssets({ tags: ['brand', 'hero'] }).length).toBe(1)
    expect(listAssets({ tags: ['brand', 'missing'] }).length).toBe(0)
  })
})
