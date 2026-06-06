/**
 * Asset metadata editing — normalizeTags, updateMetadata service (description
 * write-through + asset-level tags), PATCH /versioned/:assetId/metadata route,
 * and the upsert-from-source tag union. Isolated to a temp BAKIN_HOME.
 */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-metadata-route-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import sharp from 'sharp'
import { normalizeTags } from '../../../plugins/assets/lib/tags'
import {
  createAsset, addVersion, getAsset, promoteVersion, updateMetadata, upsertFromSource,
} from '../../../plugins/assets/lib/asset-service'
import { assetDirRelPath } from '../../../plugins/assets/lib/asset-id'
import { handleVersionedUpdateMetadata } from '../../../plugins/assets/routes/versioned'

const base = 'http://localhost/api/plugins/assets/versioned'
const patch = (path: string, body?: unknown) =>
  new Request(`${base}${path}`, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

const srcDir = join(testDir, 'src')
const png = (name: string, r: number) =>
  sharp({ create: { width: 6, height: 6, channels: 3, background: { r, g: 0, b: 0 } } }).png().toFile(join(srcDir, name))

async function freshAsset() {
  return createAsset({ sourceFilePath: join(srcDir, 'a.png'), type: 'images', agent: 'pixel', taskId: 't1', slug: 'pic', op: 'generate', description: 'first', tags: ['one'] })
}

beforeAll(async () => {
  mkdirSync(srcDir, { recursive: true })
  await png('a.png', 10)
  await png('b.png', 20)
})

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('normalizeTags', () => {
  it('trims, lowercases, hyphenates internal whitespace, dedupes, drops empties', () => {
    expect(normalizeTags(['  Hello World ', 'hello-world', 'A  B', '', '   ', 'X'])).toEqual(['hello-world', 'a-b', 'x'])
  })
  it('preserves first-seen order', () => {
    expect(normalizeTags(['beta', 'Alpha', 'BETA'])).toEqual(['beta', 'alpha'])
  })
  it('collapses tabs/newlines and passes already-normalized tags through', () => {
    expect(normalizeTags(['a\tb', 'c\nd', 'already-normal'])).toEqual(['a-b', 'c-d', 'already-normal'])
    expect(normalizeTags(['hello-world'])).toEqual(['hello-world'])
  })
})

describe('updateMetadata', () => {
  it('writes description through to asset level AND current version, capped at 200', async () => {
    const { assetId } = await freshAsset()
    await addVersion(assetId, { sourceFilePath: join(srcDir, 'b.png'), op: 'edit', description: 'second' })
    const long = 'x'.repeat(250)
    const m = await updateMetadata(assetId, { description: long })
    expect(m.description).toBe('x'.repeat(200))
    expect(m.versions.find(v => v.version === 2)!.description).toBe('x'.repeat(200))
    expect(m.versions.find(v => v.version === 1)!.description).toBe('first') // older versions untouched
  })

  it('replaces tags asset-level only, normalized', async () => {
    const { assetId } = await freshAsset()
    const m = await updateMetadata(assetId, { tags: ['Hello World', 'two', 'TWO'] })
    expect(m.tags).toEqual(['hello-world', 'two'])
    expect(m.description).toBe('first') // untouched when not provided
  })

  it('promote after edit restores that version description but never tags', async () => {
    const { assetId } = await freshAsset()
    await addVersion(assetId, { sourceFilePath: join(srcDir, 'b.png'), op: 'edit', description: 'second' })
    await updateMetadata(assetId, { description: 'edited v2', tags: ['kept'] })
    const m = await promoteVersion(assetId, 1)
    expect(m.description).toBe('first') // v1's stored description
    expect(m.tags).toEqual(['kept']) // tags survive promote
  })

  it('throws for unknown asset', async () => {
    expect(updateMetadata('20260529-ghost-deadbeef', { tags: ['x'] })).rejects.toThrow()
  })
})

describe('PATCH /versioned/:assetId/metadata', () => {
  it('updates and persists to disk atomically', async () => {
    const { assetId } = await freshAsset()
    const res = await handleVersionedUpdateMetadata(patch(`/${assetId}/metadata`, { description: 'new desc', tags: [' Tag One ', 'two'] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.asset.tags).toEqual(['tag-one', 'two'])
    // Re-read manifest from disk — not from any cache.
    const raw = JSON.parse(readFileSync(join(testDir, assetDirRelPath(assetId)!, 'manifest.json'), 'utf-8'))
    expect(raw.description).toBe('new desc')
    expect(raw.tags).toEqual(['tag-one', 'two'])
    expect(raw.versions[0].description).toBe('new desc') // write-through
  })

  it('400s an empty or invalid body', async () => {
    const { assetId } = await freshAsset()
    expect((await handleVersionedUpdateMetadata(patch(`/${assetId}/metadata`, {}))).status).toBe(400)
    expect((await handleVersionedUpdateMetadata(patch(`/${assetId}/metadata`, { tags: 'not-an-array' }))).status).toBe(400)
  })

  it('404s an unknown asset', async () => {
    const res = await handleVersionedUpdateMetadata(patch('/20260529-ghost-deadbeef/metadata', { tags: ['x'] }))
    expect(res.status).toBe(404)
  })
})

describe('upsertFromSource tag union', () => {
  it('unions provided tags into asset tags when versioning existing content', async () => {
    const sourcePath = join(srcDir, 'evolving.png')
    await png('evolving.png', 30)
    const first = await upsertFromSource(sourcePath, {
      sourceFilePath: sourcePath, type: 'images', agent: 'pixel', taskId: null, op: 'upload', tags: ['Initial Tag'],
    })
    expect(getAsset(first.assetId)!.tags).toEqual(['initial-tag'])

    await png('evolving.png', 40) // content changes → new version
    const second = await upsertFromSource(sourcePath, {
      sourceFilePath: sourcePath, type: 'images', agent: 'pixel', taskId: null, op: 'upload', tags: ['added'],
    })
    expect(second.assetId).toBe(first.assetId)
    expect(second.changed).toBe(true)
    expect(getAsset(first.assetId)!.tags).toEqual(['initial-tag', 'added']) // union, not replace
  })

  it('no-op upsert (unchanged content) still leaves tags intact', async () => {
    const sourcePath = join(srcDir, 'stable.png')
    await png('stable.png', 50)
    const first = await upsertFromSource(sourcePath, {
      sourceFilePath: sourcePath, type: 'images', agent: 'pixel', taskId: null, op: 'upload', tags: ['keep'],
    })
    const again = await upsertFromSource(sourcePath, {
      sourceFilePath: sourcePath, type: 'images', agent: 'pixel', taskId: null, op: 'upload',
    })
    expect(again.changed).toBe(false)
    expect(getAsset(first.assetId)!.tags).toEqual(['keep'])
  })
})
