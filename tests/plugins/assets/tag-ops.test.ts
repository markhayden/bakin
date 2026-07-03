/**
 * Global tag operations — renameTagGlobal / removeTagGlobal / applyTags and
 * their HTTP routes. Isolated to a temp BAKIN_HOME.
 */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, rmSync, readFileSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-tag-ops-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    assets: join(testDir, 'assets'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import sharp from 'sharp'
import {
  createAsset, getAsset, renameTagGlobal, removeTagGlobal, applyTags,
} from '../../../plugins/assets/lib/asset-service'
import { deleteAsset } from '../../../plugins/assets/lib/asset-trash'
import { assetDirRelPath } from '../../../plugins/assets/lib/asset-id'
import { handleTagsRename, handleTagsRemove, handleTagsApply } from '../../../plugins/assets/routes/tags'

const base = 'http://localhost/api/plugins/assets/tags'
const post = (path: string, body: unknown) =>
  new Request(`${base}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

const srcDir = join(testDir, 'src')

async function makeAsset(slug: string, tags: string[]) {
  const { assetId } = await createAsset({
    sourceFilePath: join(srcDir, 'a.png'), type: 'images', agent: 'pixel', taskId: null, slug, op: 'generate', description: slug, tags,
  })
  return assetId
}

beforeAll(async () => {
  mkdirSync(srcDir, { recursive: true })
  await sharp({ create: { width: 6, height: 6, channels: 3, background: { r: 9, g: 0, b: 0 } } }).png().toFile(join(srcDir, 'a.png'))
})

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('renameTagGlobal', () => {
  it('renames across all carrying assets, merge-dedupes on collision, skips others', async () => {
    const a = await makeAsset('ra', ['old-name', 'other'])
    const b = await makeAsset('rb', ['old-name', 'new-name']) // collision → merge
    const c = await makeAsset('rc', ['unrelated'])
    const cManifestPath = join(testDir, assetDirRelPath(c)!, 'manifest.json')
    const cBefore = readFileSync(cManifestPath, 'utf-8')
    const cMtime = statSync(cManifestPath).mtimeMs

    const { updated } = await renameTagGlobal('old-name', 'New Name')
    expect(updated).toBe(2)
    expect(getAsset(a)!.tags).toEqual(['new-name', 'other'])
    expect(getAsset(b)!.tags).toEqual(['new-name'])
    expect(getAsset(c)!.tags).toEqual(['unrelated'])
    expect(readFileSync(cManifestPath, 'utf-8')).toBe(cBefore) // untouched bytes
    expect(statSync(cManifestPath).mtimeMs).toBe(cMtime)
  })

  it('does not touch trashed assets', async () => {
    const t = await makeAsset('rt', ['doomed'])
    const { trashName } = await deleteAsset(t)
    const { updated } = await renameTagGlobal('doomed', 'renamed')
    expect(updated).toBe(0)
    const raw = JSON.parse(readFileSync(join(testDir, 'assets', '.trash', trashName, 'manifest.json'), 'utf-8'))
    expect(raw.tags).toEqual(['doomed'])
  })
})

describe('removeTagGlobal', () => {
  it('removes the tag from every carrying asset, leaves assets intact', async () => {
    const a = await makeAsset('da', ['kill-me', 'keep'])
    const b = await makeAsset('db', ['keep'])
    const { updated } = await removeTagGlobal('kill-me')
    expect(updated).toBe(1)
    expect(getAsset(a)!.tags).toEqual(['keep'])
    expect(getAsset(b)!.tags).toEqual(['keep'])
  })
})

describe('applyTags', () => {
  it('no-ops without rewriting manifests when add and remove are empty', async () => {
    const a = await makeAsset('noop', ['keep'])
    const manifestPath = join(testDir, assetDirRelPath(a)!, 'manifest.json')
    const before = readFileSync(manifestPath, 'utf-8')
    const res = await applyTags([a], {})
    expect(res).toEqual({ updated: 0, failed: [] })
    expect(readFileSync(manifestPath, 'utf-8')).toBe(before)
  })

  it('adds and removes across a set, normalized, with per-asset results', async () => {
    const a = await makeAsset('ba', ['x'])
    const b = await makeAsset('bb', [])
    const res = await applyTags([a, b, '20260529-ghost-deadbeef'], { add: ['New Tag'], remove: ['x'] })
    expect(getAsset(a)!.tags).toEqual(['new-tag'])
    expect(getAsset(b)!.tags).toEqual(['new-tag'])
    expect(res.updated).toBe(2)
    expect(res.failed).toEqual(['20260529-ghost-deadbeef']) // unknown id doesn't abort the rest
  })

  it('re-applying tags an asset already has is a true no-op — no dupes, no manifest rewrite', async () => {
    const a = await makeAsset('dedupe', ['keep', 'other'])
    const manifestPath = join(testDir, assetDirRelPath(a)!, 'manifest.json')
    const before = readFileSync(manifestPath, 'utf-8')
    const res = await applyTags([a], { add: ['Keep'] }) // normalizes to existing 'keep'
    expect(res.updated).toBe(0)
    expect(getAsset(a)!.tags).toEqual(['keep', 'other'])
    expect(readFileSync(manifestPath, 'utf-8')).toBe(before) // updated timestamp untouched, no reindex
  })
})

describe('tag routes', () => {
  it('POST /tags/rename validates and renames', async () => {
    const a = await makeAsset('hra', ['route-old'])
    const res = await handleTagsRename(post('/rename', { from: 'route-old', to: 'Route New' }))
    expect(res.status).toBe(200)
    expect((await res.json()).updated).toBe(1)
    expect(getAsset(a)!.tags).toEqual(['route-new'])
    expect((await handleTagsRename(post('/rename', { from: '', to: 'x' }))).status).toBe(400)
    expect((await handleTagsRename(post('/rename', { from: 'x' }))).status).toBe(400)
  })

  it('POST /tags/remove validates and removes', async () => {
    const a = await makeAsset('hda', ['gone'])
    const res = await handleTagsRemove(post('/remove', { tag: 'gone' }))
    expect(res.status).toBe(200)
    expect(getAsset(a)!.tags).toEqual([])
    expect((await handleTagsRemove(post('/remove', {}))).status).toBe(400)
  })

  it('POST /tags/apply validates and applies', async () => {
    const a = await makeAsset('hba', [])
    const res = await handleTagsApply(post('/apply', { assetIds: [a], add: ['bulk'] }))
    expect(res.status).toBe(200)
    expect(getAsset(a)!.tags).toEqual(['bulk'])
    expect((await handleTagsApply(post('/apply', { assetIds: [], add: ['x'] }))).status).toBe(400)
    expect((await handleTagsApply(post('/apply', { assetIds: [a] }))).status).toBe(400) // neither add nor remove
  })
})
