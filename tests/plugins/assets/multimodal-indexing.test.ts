/**
 * Unit coverage for the multimodal indexing path in the assets plugin.
 * Verifies that:
 *   - bakin_assets is registered with two indexes (assets_text, assets_visual)
 *   - image_url is computed for raster images (CLIP-compatible) only
 *   - SVG and non-image assets get no image_url
 *   - content is populated server-side for text and (mocked) PDF assets
 *     via extractAssetContent, NOT via {{remotePDF}}/{{remoteText}} helpers
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { activatePlugin } from '../test-helpers'
import type {
  SearchContentTypeDefinition,
  SearchIndexDefinition,
} from '../../../src/lib/plugin-types'

const testDir = join(tmpdir(), `bakin-test-multimodal-${Date.now()}`)
const assetsRoot = join(testDir, 'assets')

// Canonical filenames for the four test assets. The YYYYMMDD prefix
// determines the month shard under assets/store/{YYYY-MM}/.
const MONTH = '2026-04'
const STORE_DIR = join(assetsRoot, 'store', MONTH)
const PDF_FILENAME = '20260411-wyoming-bbbbbbbb.pdf'
const IMG_FILENAME = '20260411-diagram-aaaaaaaa.png'
const SVG_FILENAME = '20260411-icon-cccccccc.svg'
const MD_FILENAME = '20260411-notes-dddddddd.md'

// ---------------------------------------------------------------------------
// Mocks (must be defined before importing the plugin)
// ---------------------------------------------------------------------------

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

function setupFixtures() {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true })
  mkdirSync(STORE_DIR, { recursive: true })

  // PDF asset (mocked pdf-parse returns synthetic content)
  writeFileSync(join(STORE_DIR, PDF_FILENAME), 'fake-pdf-bytes')
  writeFileSync(
    join(STORE_DIR, `${PDF_FILENAME}.meta.json`),
    JSON.stringify({
      agent: 'main',
      taskId: 'task-1',
      created: '2026-04-11T00:00:00.000Z',
      type: 'other',
      description: 'Wyoming LLC operating agreement',
      tags: ['legal', 'llc'],
    }),
  )

  // Raster image asset
  writeFileSync(join(STORE_DIR, IMG_FILENAME), 'png-bytes')
  writeFileSync(
    join(STORE_DIR, `${IMG_FILENAME}.meta.json`),
    JSON.stringify({
      agent: 'main',
      taskId: 'task-1',
      created: '2026-04-11T00:00:00.000Z',
      type: 'images',
      description: 'Kafka pipeline diagram',
      tags: ['architecture'],
    }),
  )

  // SVG asset — vector, should be excluded from image_url
  writeFileSync(join(STORE_DIR, SVG_FILENAME), '<svg/>')
  writeFileSync(
    join(STORE_DIR, `${SVG_FILENAME}.meta.json`),
    JSON.stringify({
      agent: 'main',
      taskId: 'task-1',
      created: '2026-04-11T00:00:00.000Z',
      type: 'images',
      description: 'Vector icon',
      tags: ['ui'],
    }),
  )

  // Markdown asset with body content that should be extracted into `content`
  writeFileSync(
    join(STORE_DIR, MD_FILENAME),
    '# Meeting Notes\n\nautolyse banneton sourdough bulk fermentation',
  )
  writeFileSync(
    join(STORE_DIR, `${MD_FILENAME}.meta.json`),
    JSON.stringify({
      agent: 'main',
      taskId: 'task-1',
      created: '2026-04-11T00:00:00.000Z',
      type: 'text',
      description: 'Meeting notes',
      tags: [],
    }),
  )
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

  it('text index template references the content field directly (no remotePDF)', async () => {
    const def = await getRegisteredDef()
    const textIndex = (def.indexes as SearchIndexDefinition[]).find(i => i.name === 'assets_text')!

    expect(textIndex.embedderRef).toBe('default')
    expect(textIndex.embeddingTemplate).toContain('{{description}}')
    expect(textIndex.embeddingTemplate).toContain('{{content}}')
    // The old {{remotePDF}} path is dead — Antfly's Go PDF library fails
    // silently on real-world PDFs (see Bakin issue #72).
    expect(textIndex.embeddingTemplate).not.toContain('{{remotePDF')
    expect(textIndex.chunker?.enabled).toBe(true)
  })

  it('visual index uses visual embedder with remoteMedia helper', async () => {
    const def = await getRegisteredDef()
    const visualIndex = (def.indexes as SearchIndexDefinition[]).find(i => i.name === 'assets_visual')!

    expect(visualIndex.embedderRef).toBe('visual')
    expect(visualIndex.embeddingTemplate).toContain('{{remoteMedia url=image_url}}')
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

  it('reindex populates content from markdown body', async () => {
    const def = await getRegisteredDef()

    const docs: Record<string, Record<string, unknown>> = {}
    for await (const { key, doc } of def.reindex()) {
      docs[key] = doc as Record<string, unknown>
    }

    const mdDoc = docs[`assets/store/${MONTH}/${MD_FILENAME}`]
    expect(mdDoc).toBeDefined()
    expect(mdDoc.content).toContain('autolyse')
    expect(mdDoc.content).toContain('banneton')
    expect(mdDoc.image_url).toBe('')
  })

  it('reindex populates content from PDF body via pdf-parse', async () => {
    const def = await getRegisteredDef()

    const docs: Record<string, Record<string, unknown>> = {}
    for await (const { key, doc } of def.reindex()) {
      docs[key] = doc as Record<string, unknown>
    }

    const pdfDoc = docs[`assets/store/${MONTH}/${PDF_FILENAME}`]
    expect(pdfDoc).toBeDefined()
    // The mocked pdf-parse returns synthetic content — presence proves the
    // extractor was called, not just that metadata was copied.
    expect(pdfDoc.content).toContain('MOCK PDF CONTENT')
    expect(pdfDoc.image_url).toBe('')
  })

  it('reindex populates image_url for raster images and empty content', async () => {
    const def = await getRegisteredDef()

    const docs: Record<string, Record<string, unknown>> = {}
    for await (const { key, doc } of def.reindex()) {
      docs[key] = doc as Record<string, unknown>
    }

    const imageDoc = docs[`assets/store/${MONTH}/${IMG_FILENAME}`]
    expect(imageDoc).toBeDefined()
    const expectedAbsPath = join(STORE_DIR, IMG_FILENAME)
    expect(imageDoc.image_url).toBe(`file://${expectedAbsPath}`)
    // Images are not text-extractable — content stays empty, CLIP handles
    // the pixel data through the visual index template.
    expect(imageDoc.content).toBe('')
  })

  it('excludes SVG from image_url and leaves content empty', async () => {
    const def = await getRegisteredDef()

    const docs: Record<string, Record<string, unknown>> = {}
    for await (const { key, doc } of def.reindex()) {
      docs[key] = doc as Record<string, unknown>
    }

    const svgDoc = docs[`assets/store/${MONTH}/${SVG_FILENAME}`]
    expect(svgDoc).toBeDefined()
    expect(svgDoc.image_url).toBe('')
    expect(svgDoc.content).toBe('')
    // Sidecar metadata is still indexed via description/tags/filename
    expect(svgDoc.description).toBe('Vector icon')
  })

  it('preserves existing sidecar metadata fields alongside extracted content', async () => {
    const def = await getRegisteredDef()

    const docs: Record<string, Record<string, unknown>> = {}
    for await (const { key, doc } of def.reindex()) {
      docs[key] = doc as Record<string, unknown>
    }

    const pdfDoc = docs[`assets/store/${MONTH}/${PDF_FILENAME}`]
    expect(pdfDoc.description).toBe('Wyoming LLC operating agreement')
    expect(pdfDoc.tags).toBe('legal, llc')
    expect(pdfDoc.agent).toBe('main')
    expect(pdfDoc.task_id).toBe('task-1')
    expect(pdfDoc.asset_type).toBe('other')
    expect(pdfDoc.file_name).toBe(PDF_FILENAME)
  })
})
