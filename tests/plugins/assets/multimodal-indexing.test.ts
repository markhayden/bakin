/**
 * Unit coverage for the multimodal indexing path in the assets plugin.
 * Verifies that:
 *   - bakin_assets is registered with two indexes (assets_text, assets_visual)
 *   - image_url is computed for raster images (CLIP-compatible) only
 *   - SVG and non-image assets get no image_url
 *   - content is populated server-side for text and (mocked) PDF assets
 *     via extractAssetContent, not provider-side file fetch helpers
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { activatePlugin } from '../test-helpers'
import type {
  SearchContentTypeDefinition,
  SearchIndexDefinition,
} from '@bakin/core/plugin-types'

const testDir = join(tmpdir(), `bakin-test-multimodal-${Date.now()}`)
const assetsRoot = join(testDir, 'assets')

// AssetIds for the four versioned test assets. The YYYYMMDD prefix determines
// the month shard under assets/store/{YYYY-MM}/<assetId>/.
const MONTH = '2026-04'
const STORE_DIR = join(assetsRoot, 'store', MONTH)
const PDF_ID = '20260411-wyoming-bbbbbbbb'
const IMG_ID = '20260411-diagram-aaaaaaaa'
const SVG_ID = '20260411-icon-cccccccc'
const MD_ID = '20260411-notes-dddddddd'

// ---------------------------------------------------------------------------
// Mocks (must be defined before importing the plugin)
// ---------------------------------------------------------------------------

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    assets: assetsRoot,
  }),
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

mock.module('../../../src/core/watcher', () => ({
  registerSyncHook: mock(),
}))

// Mock pdf-parse so PDF tests don't require a real PDF — the extractor
// lazy-imports the module, and this mock replaces it. pdf-parse v2
// exports a PDFParse class, not a default function.
mock.module('pdf-parse', () => {
  class MockPDFParse {
    private byteLen: number
    constructor(options: { data: Uint8Array }) {
      this.byteLen = options.data.length
    }
    async getText() {
      return { text: `MOCK PDF CONTENT: ${this.byteLen} bytes extracted` }
    }
    async destroy() {}
  }
  return { PDFParse: MockPDFParse }
})

import assetsPlugin from '@bakin/assets'

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

/** Seed one versioned asset directory (manifest + current-version file). */
function seedVersioned(
  assetId: string,
  type: string,
  file: string,
  mimeType: string,
  body: string,
  description: string,
  tags: string[],
) {
  const dir = join(STORE_DIR, assetId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, file), body)
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    assetId, type, source: { kind: 'generated', path: null },
    agent: 'main', taskId: 'task-1', created: '2026-04-11T00:00:00.000Z', updated: '2026-04-11T00:00:00.000Z',
    currentVersion: 1, description, tags,
    versions: [{
      version: 1, file, thumb: null, mimeType, size: body.length,
      width: null, height: null, created: '2026-04-11T00:00:00.000Z', description, tags,
      op: 'generate', parentVersion: null, tool: null, prompt: null, promptHash: null, generation: null,
    }],
    exports: [],
  }))
}

function setupFixtures() {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true })
  mkdirSync(STORE_DIR, { recursive: true })

  // PDF asset (mocked pdf-parse returns synthetic content)
  seedVersioned(PDF_ID, 'pdf', 'v1.pdf', 'application/pdf', 'fake-pdf-bytes', 'Wyoming LLC operating agreement', ['legal', 'llc'])
  // Raster image asset
  seedVersioned(IMG_ID, 'images', 'v1.png', 'image/png', 'png-bytes', 'Kafka pipeline diagram', ['architecture'])
  // SVG asset — vector, should be excluded from image_url
  seedVersioned(SVG_ID, 'images', 'v1.svg', 'image/svg+xml', '<svg/>', 'Vector icon', ['ui'])
  // Markdown asset whose body is extracted into `content`
  seedVersioned(MD_ID, 'text', 'v1.md', 'text/markdown', '# Meeting Notes\n\nautolyse banneton sourdough bulk fermentation', 'Meeting notes', [])
}

describe('assets multimodal indexing', () => {
  beforeAll(() => setupFixtures())
  afterAll(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
  })

  async function getRegisteredDef(): Promise<SearchContentTypeDefinition> {
    const { ctx } = await activatePlugin(assetsPlugin, testDir)
    const mockRegister = ctx.search.registerFileBackedContentType as unknown as { mock: { calls: unknown[][] } }
    const def = mockRegister.mock.calls[0][0] as SearchContentTypeDefinition
    return def
  }

  it('registers bakin_assets with two indexes — text and visual', async () => {
    const def = await getRegisteredDef()

    expect(def.table).toBe('assets')
    expect(def.indexes).toBeDefined()
    expect(def.indexes).toHaveLength(2)

    const byName = Object.fromEntries(
      (def.indexes as SearchIndexDefinition[]).map(i => [i.name, i]),
    )
    expect(byName.assets_text).toBeDefined()
    expect(byName.assets_visual).toBeDefined()
  })

  it('text index template references the content field directly', async () => {
    const def = await getRegisteredDef()
    const textIndex = (def.indexes as SearchIndexDefinition[]).find(i => i.name === 'assets_text')!

    expect(textIndex.embedderRef).toBe('default')
    expect(textIndex.embeddingTemplate).toContain('{{description}}')
    expect(textIndex.embeddingTemplate).toContain('{{content}}')
    expect(textIndex.embeddingTemplate).not.toContain('remote')
    expect(textIndex.chunker?.enabled).toBe(true)
  })

  it('visual index uses visual embedder with a generic media URL field', async () => {
    const def = await getRegisteredDef()
    const visualIndex = (def.indexes as SearchIndexDefinition[]).find(i => i.name === 'assets_visual')!

    expect(visualIndex.embedderRef).toBe('visual')
    expect(visualIndex.mediaUrlField).toBe('image_url')
    expect(visualIndex.embeddingTemplate).toBeUndefined()
  })

  it('schema includes content and image_url; no pdf_url', async () => {
    const def = await getRegisteredDef()
    expect(def.schema.content).toEqual({ type: 'text' })
    expect(def.schema.image_url).toEqual({ type: 'keyword' })
    expect(def.schema.pdf_url).toBeUndefined()
  })

  it('does not set rerankField — multimodal table skips the cross-encoder', async () => {
    const def = await getRegisteredDef()
    // The cross-encoder reranker scores against a single document field.
    // For multimodal content (PDF body in `content`, images in the visual
    // index, metadata in `description`), no single field works. Raw RRF
    // ranking is correct; the reranker creates inversions.
    expect(def.rerankField).toBeUndefined()
  })

  async function reindexDocs(): Promise<Record<string, Record<string, unknown>>> {
    const def = await getRegisteredDef()
    const docs: Record<string, Record<string, unknown>> = {}
    for await (const { key, doc } of def.reindex()) {
      docs[key] = doc as Record<string, unknown>
    }
    return docs
  }

  it('reindex populates content from markdown body', async () => {
    const mdDoc = (await reindexDocs())[MD_ID]
    expect(mdDoc).toBeDefined()
    expect(mdDoc.content).toContain('autolyse')
    expect(mdDoc.content).toContain('banneton')
    expect(mdDoc.image_url).toBe('')
  })

  it('reindex populates content from PDF body via pdf-parse', async () => {
    const pdfDoc = (await reindexDocs())[PDF_ID]
    expect(pdfDoc).toBeDefined()
    // The mocked pdf-parse returns synthetic content — presence proves the
    // extractor was called, not just that metadata was copied.
    expect(pdfDoc.content).toContain('MOCK PDF CONTENT')
    expect(pdfDoc.image_url).toBe('')
  })

  it('reindex populates image_url for raster images and empty content', async () => {
    const imageDoc = (await reindexDocs())[IMG_ID]
    expect(imageDoc).toBeDefined()
    // image_url is a file:// URL pointing at the current version's file.
    expect(String(imageDoc.image_url)).toContain(`store/${MONTH}/${IMG_ID}/v1.png`)
    // Images are not text-extractable — content stays empty, CLIP handles
    // the pixel data through the visual index template.
    expect(imageDoc.content).toBe('')
  })

  it('excludes SVG from image_url and leaves content empty', async () => {
    const svgDoc = (await reindexDocs())[SVG_ID]
    expect(svgDoc).toBeDefined()
    expect(svgDoc.image_url).toBe('')
    expect(svgDoc.content).toBe('')
    // Manifest metadata is still indexed via description/tags/filename
    expect(svgDoc.description).toBe('Vector icon')
  })

  it('preserves manifest metadata fields alongside extracted content', async () => {
    const pdfDoc = (await reindexDocs())[PDF_ID]
    expect(pdfDoc.description).toBe('Wyoming LLC operating agreement')
    expect(pdfDoc.tags).toBe('legal, llc')
    expect(pdfDoc.agent).toBe('main')
    expect(pdfDoc.task_id).toBe('task-1')
    expect(pdfDoc.asset_type).toBe('pdf')
    // The search row is keyed by assetId; file_name carries the assetId.
    expect(pdfDoc.file_name).toBe(PDF_ID)
  })
})
