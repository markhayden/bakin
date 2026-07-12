/**
 * B4: versioned-asset search docs — path classification + current-version doc.
 */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-search-doc-${Date.now()}-${randomUUID()}`)
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
import { createAsset } from '../../../plugins/assets/lib/asset-service'
import { getAsset } from '../../../plugins/assets/lib/asset-service'
import { versionedAssetPath, buildVersionedAssetSearchDoc } from '../../../plugins/assets/lib/search-doc'

const srcDir = join(testDir, 'src')

beforeAll(async () => {
  mkdirSync(srcDir, { recursive: true })
  await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 5, g: 5, b: 5 } } }).png().toFile(join(srcDir, 'p.png'))
  writeFileSync(join(srcDir, 'doc.md'), '# Title\nsearchable body text\n', 'utf-8')
})

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('versionedAssetPath', () => {
  const id = '20260529-x-aabbccdd'
  it('identifies a manifest', () => {
    expect(versionedAssetPath(`assets/store/2026-05/${id}/manifest.json`)).toEqual({ assetId: id, isManifest: true })
  })
  it('identifies non-manifest files inside an asset dir', () => {
    expect(versionedAssetPath(`assets/store/2026-05/${id}/v1.png`)).toEqual({ assetId: id, isManifest: false })
    expect(versionedAssetPath(`assets/store/2026-05/${id}/exports/og.jpg`)).toEqual({ assetId: id, isManifest: false })
  })
  it('returns null for legacy flat assets and junk', () => {
    expect(versionedAssetPath('assets/store/2026-05/20260529-x-aabbccdd.png')).toBeNull() // has extension
    expect(versionedAssetPath('assets/store/2026-05/note.txt.meta.json')).toBeNull()
    expect(versionedAssetPath('assets/inbox/foo.png')).toBeNull()
  })
})

describe('buildVersionedAssetSearchDoc', () => {
  it('builds an image doc keyed by assetId with a visual media_url', async () => {
    const { assetId } = await createAsset({ sourceFilePath: join(srcDir, 'p.png'), type: 'images', agent: 'pixel', taskId: 't1', slug: 'p', op: 'generate', description: 'a pic', tags: ['hero'] })
    const doc = await buildVersionedAssetSearchDoc(getAsset(assetId)!, assetId)
    expect(doc.file_name).toBe(assetId)
    expect(doc.asset_type).toBe('images')
    expect(doc.description).toBe('a pic')
    expect(doc.tags).toBe('hero')
    expect(doc.tags_facet).toEqual(['hero']) // keyword array for faceting
    expect(doc.agent).toBe('pixel')
    expect(doc.task_id).toBe('t1')
    expect(String(doc.media_url)).toContain('store/')
    // media_url prefers the JPEG thumb rendition — engines choke on some
    // originals (antfly decodes PNG/JPEG/GIF only) and CLIP downscales anyway.
    expect(String(doc.media_url)).toContain('.thumb.jpg')
  })

  it('webp original: media_url uses the JPEG thumb (undecodable originals poison the whole row — antfly#322)', async () => {
    await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 9, g: 9, b: 9 } } }).webp().toFile(join(srcDir, 'w.webp'))
    const { assetId } = await createAsset({ sourceFilePath: join(srcDir, 'w.webp'), type: 'images', agent: 'user', taskId: null, slug: 'w', op: 'upload' })
    const doc = await buildVersionedAssetSearchDoc(getAsset(assetId)!, assetId)
    expect(String(doc.media_url)).toContain('.thumb.jpg')
    expect(String(doc.media_url)).not.toContain('.webp')
  })

  it('no thumb: decodable originals pass through, undecodable ones get NO media_url', async () => {
    const { assetId } = await createAsset({ sourceFilePath: join(srcDir, 'p.png'), type: 'images', agent: 'user', taskId: null, slug: 'nothumb', op: 'upload' })
    const manifest = structuredClone(getAsset(assetId)!)
    const current = manifest.versions.find((v) => v.version === manifest.currentVersion)!
    current.thumb = null
    expect(String((await buildVersionedAssetSearchDoc(manifest, assetId)).media_url)).toContain('v1.png')
    // rc.18 decodes WebP — originals pass through now (GATE B re-verdict).
    current.file = 'v1.webp'
    expect(String((await buildVersionedAssetSearchDoc(manifest, assetId)).media_url)).toContain('v1.webp')
    // Still-undecodable formats stay excluded: one bad media_url poisons
    // the row's entire batch write (pinned in workaround-regressions).
    current.file = 'v1.tiff'
    expect((await buildVersionedAssetSearchDoc(manifest, assetId)).media_url).toBe('')
  })

  it('builds a text doc with extracted content and no media_url', async () => {
    const { assetId } = await createAsset({ sourceFilePath: join(srcDir, 'doc.md'), type: 'text', agent: 'margo', taskId: null, slug: 'doc', op: 'upload' })
    const doc = await buildVersionedAssetSearchDoc(getAsset(assetId)!, assetId)
    expect(doc.asset_type).toBe('text')
    expect(doc.media_url).toBe('')
    expect(String(doc.content)).toContain('searchable body text')
  })

  it('carries generation provenance — surface searchable, provider/model facetable', async () => {
    const { assetId } = await createAsset({
      sourceFilePath: join(srcDir, 'p.png'), type: 'images', agent: 'pixel', taskId: null, slug: 'gen', op: 'generate',
      description: 'generated pic', source: { kind: 'generated', path: null },
      generation: { provider: 'openai', model: 'gpt-image-2', surface: 'instagram-feed-portrait', quality: 'standard', routeSource: 'runtime' },
    })
    const doc = await buildVersionedAssetSearchDoc(getAsset(assetId)!, assetId)
    expect(doc.surface).toBe('instagram-feed-portrait')
    expect(doc.provider).toBe('openai')
    expect(doc.model).toBe('gpt-image-2')
  })

  it('yields empty provenance fields when the current version has no generation (uploads)', async () => {
    const { assetId } = await createAsset({ sourceFilePath: join(srcDir, 'doc.md'), type: 'text', agent: 'margo', taskId: null, slug: 'plain', op: 'upload' })
    const doc = await buildVersionedAssetSearchDoc(getAsset(assetId)!, assetId)
    expect(doc.surface).toBe('')
    expect(doc.provider).toBe('')
    expect(doc.model).toBe('')
    expect(doc.tags_facet).toEqual([])
  })
})
