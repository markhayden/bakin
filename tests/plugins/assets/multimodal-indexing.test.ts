/**
 * Unit coverage for the multimodal indexing path in the assets plugin.
 * Verifies that:
 *   - bakin_assets is registered with two indexes (assets_text, assets_visual)
 *     pointing at the right embedders and templates
 *   - pdf_url is computed for .pdf files only, image_url for asset_type='images'
 *   - non-PDF, non-image files get empty pdf_url and image_url
 *   - URLs are file:// references under the assets root (Antfly reads the
 *     file directly from disk — no internal HTTP file server involved)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
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

// ---------------------------------------------------------------------------
// Mocks (must be defined before importing the plugin)
// ---------------------------------------------------------------------------

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    assets: assetsRoot,
    'assets.text': join(assetsRoot, 'text'),
    'assets.images': join(assetsRoot, 'images'),
    'assets.video': join(assetsRoot, 'video'),
    'assets.audio': join(assetsRoot, 'audio'),
    'assets.plans': join(assetsRoot, 'plans'),
    'assets.data': join(assetsRoot, 'data'),
    'assets.other': join(assetsRoot, 'other'),
  }),
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('../../../src/core/watcher', () => ({
  registerSyncHook: vi.fn(),
}))

import assetsPlugin from '@bakin/assets'

// ---------------------------------------------------------------------------
// Fixture setup: create sidecars for a PDF, an image, and a text file
// ---------------------------------------------------------------------------

function setupFixtures() {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true })
  mkdirSync(join(assetsRoot, 'other', 'task-1'), { recursive: true })
  mkdirSync(join(assetsRoot, 'images', 'task-1'), { recursive: true })
  mkdirSync(join(assetsRoot, 'text', 'task-1'), { recursive: true })

  // PDF asset
  writeFileSync(join(assetsRoot, 'other', 'task-1', 'wyoming.pdf'), 'pdf-bytes')
  writeFileSync(
    join(assetsRoot, 'other', 'task-1', 'wyoming.pdf.meta.json'),
    JSON.stringify({
      agent: 'main-operator',
      taskId: 'task-1',
      created: '2026-04-11T00:00:00.000Z',
      description: 'Wyoming LLC operating agreement',
      tags: ['legal', 'llc'],
    }),
  )

  // Image asset
  writeFileSync(join(assetsRoot, 'images', 'task-1', 'diagram.png'), 'png-bytes')
  writeFileSync(
    join(assetsRoot, 'images', 'task-1', 'diagram.png.meta.json'),
    JSON.stringify({
      agent: 'main-operator',
      taskId: 'task-1',
      created: '2026-04-11T00:00:00.000Z',
      description: 'Kafka pipeline diagram',
      tags: ['architecture'],
    }),
  )

  // Plain text asset — should get no media URLs
  writeFileSync(join(assetsRoot, 'text', 'task-1', 'notes.txt'), 'plain text')
  writeFileSync(
    join(assetsRoot, 'text', 'task-1', 'notes.txt.meta.json'),
    JSON.stringify({
      agent: 'main-operator',
      taskId: 'task-1',
      created: '2026-04-11T00:00:00.000Z',
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
    const mockRegister = ctx.search.registerContentType as unknown as { mock: { calls: unknown[][] } }
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

  it('text index uses default embedder with PDF extraction helper', async () => {
    const def = await getRegisteredDef()
    const textIndex = (def.indexes as SearchIndexDefinition[]).find(i => i.name === 'assets_text')!

    expect(textIndex.embedderRef).toBe('default')
    expect(textIndex.embeddingTemplate).toContain('{{description}}')
    expect(textIndex.embeddingTemplate).toContain('{{remotePDF url=pdf_url}}')
    expect(textIndex.chunker?.enabled).toBe(true)
  })

  it('visual index uses visual embedder with remoteMedia helper', async () => {
    const def = await getRegisteredDef()
    const visualIndex = (def.indexes as SearchIndexDefinition[]).find(i => i.name === 'assets_visual')!

    expect(visualIndex.embedderRef).toBe('visual')
    expect(visualIndex.embeddingTemplate).toContain('{{remoteMedia url=image_url}}')
  })

  it('schema includes pdf_url and image_url keyword fields', async () => {
    const def = await getRegisteredDef()
    expect(def.schema.pdf_url).toEqual({ type: 'keyword' })
    expect(def.schema.image_url).toEqual({ type: 'keyword' })
  })

  it('reindex yields a doc with pdf_url set for a PDF asset', async () => {
    const def = await getRegisteredDef()

    const docs: Record<string, Record<string, unknown>> = {}
    for await (const { key, doc } of def.reindex()) {
      docs[key] = doc as Record<string, unknown>
    }

    const pdfDoc = docs['assets/other/task-1/wyoming.pdf']
    expect(pdfDoc).toBeDefined()
    const expectedAbsPath = join(assetsRoot, 'other', 'task-1', 'wyoming.pdf')
    expect(pdfDoc.pdf_url).toBe(`file://${expectedAbsPath}`)
    expect(pdfDoc.image_url).toBe('')
  })

  it('reindex yields a doc with image_url set for an image asset', async () => {
    const def = await getRegisteredDef()

    const docs: Record<string, Record<string, unknown>> = {}
    for await (const { key, doc } of def.reindex()) {
      docs[key] = doc as Record<string, unknown>
    }

    const imageDoc = docs['assets/images/task-1/diagram.png']
    expect(imageDoc).toBeDefined()
    const expectedAbsPath = join(assetsRoot, 'images', 'task-1', 'diagram.png')
    expect(imageDoc.image_url).toBe(`file://${expectedAbsPath}`)
    expect(imageDoc.pdf_url).toBe('')
  })

  it('reindex yields a doc with empty media URLs for a plain text asset', async () => {
    const def = await getRegisteredDef()

    const docs: Record<string, Record<string, unknown>> = {}
    for await (const { key, doc } of def.reindex()) {
      docs[key] = doc as Record<string, unknown>
    }

    const textDoc = docs['assets/text/task-1/notes.txt']
    expect(textDoc).toBeDefined()
    expect(textDoc.pdf_url).toBe('')
    expect(textDoc.image_url).toBe('')
  })

  it('preserves existing sidecar metadata fields alongside media URLs', async () => {
    const def = await getRegisteredDef()

    const docs: Record<string, Record<string, unknown>> = {}
    for await (const { key, doc } of def.reindex()) {
      docs[key] = doc as Record<string, unknown>
    }

    const pdfDoc = docs['assets/other/task-1/wyoming.pdf']
    expect(pdfDoc.description).toBe('Wyoming LLC operating agreement')
    expect(pdfDoc.tags).toBe('legal, llc')
    expect(pdfDoc.agent).toBe('main-operator')
    expect(pdfDoc.task_id).toBe('task-1')
    expect(pdfDoc.asset_type).toBe('other')
    expect(pdfDoc.file_name).toBe('wyoming.pdf')
  })
})
