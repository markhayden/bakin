import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = mkdtempSync(join(tmpdir(), 'bakin-test-pdf-engine-'))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db'), bin: join(testDir, 'bin') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db'), bin: join(testDir, 'bin') }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { readPdf, renderPdfPages, PdfError, selectPages, capPageTexts } from '../../../src/core/pdf/engine'
import { MAX_PDF_PAGES, MAX_CHARS, RENDER_MAX_PAGES, RENDER_WIDTH } from '../../../src/core/pdf/limits'

const TEXT_PDF = join(import.meta.dir, '../../fixtures/pdf/text.pdf')
const SCANNED_PDF = join(import.meta.dir, '../../fixtures/pdf/scanned.pdf')

const renderDirs: string[] = []
afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
  for (const dir of renderDirs) rmSync(dir, { recursive: true, force: true })
})

describe('readPdf', () => {
  test('extracts info + per-page text from a text PDF', async () => {
    const result = await readPdf(TEXT_PDF)
    expect(result.info.pageCount).toBe(2)
    expect(result.pages).toHaveLength(2)
    expect(result.pages[0]!.page).toBe(1)
    expect(result.pages[0]!.text).toContain('BAKIN FIXTURE PAGE ONE')
    expect(result.pages[0]!.text).toContain('alpha-7291')
    expect(result.pages[1]!.text).toContain('omega-3348')
    expect(result.pages.every((p) => p.likelyScanned === false)).toBe(true)
    expect(result.truncated).toBe(false)
  })

  test('honors page selection', async () => {
    const result = await readPdf(TEXT_PDF, [2])
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0]!.page).toBe(2)
    expect(result.pages[0]!.text).toContain('BAKIN FIXTURE PAGE TWO')
  })

  test('flags image-only pages as likelyScanned', async () => {
    const result = await readPdf(SCANNED_PDF)
    expect(result.info.pageCount).toBe(2)
    expect(result.pages.every((p) => p.likelyScanned === true)).toBe(true)
    expect(result.pages.every((p) => p.text.trim().length === 0)).toBe(true)
  })

  test('rejects a non-PDF file by magic bytes', async () => {
    const fake = join(testDir, 'fake.pdf')
    writeFileSync(fake, 'this is not a pdf at all')
    expect(readPdf(fake)).rejects.toMatchObject({ kind: 'not_a_pdf' })
  })

  test('rejects a missing file', async () => {
    expect(readPdf(join(testDir, 'missing.pdf'))).rejects.toMatchObject({ kind: 'not_found' })
  })

  test('wraps parser failures as parse_failed', async () => {
    const corrupt = join(testDir, 'corrupt.pdf')
    writeFileSync(corrupt, '%PDF-1.4\ngarbage that is not a real document')
    expect(readPdf(corrupt)).rejects.toMatchObject({ kind: 'parse_failed' })
  })
})

describe('renderPdfPages', () => {
  test('renders a selected page to a PNG at the fixed width', async () => {
    const result = await renderPdfPages(TEXT_PDF, [1])
    renderDirs.push(result.outDir)
    expect(result.outDir).toContain('bakin-pdf-render-')
    expect(result.files).toHaveLength(1)
    const f = result.files[0]!
    expect(f.page).toBe(1)
    expect(f.width).toBe(RENDER_WIDTH)
    expect(existsSync(f.path)).toBe(true)
    const bytes = readFileSync(f.path)
    expect(bytes.length).toBeGreaterThan(0)
    // PNG magic
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })

  test('renders all pages by default when under the cap', async () => {
    const result = await renderPdfPages(SCANNED_PDF)
    renderDirs.push(result.outDir)
    expect(result.files).toHaveLength(2)
    expect(result.files.map((f) => f.page)).toEqual([1, 2])
  })

  test('refuses more than RENDER_MAX_PAGES pages per call', async () => {
    const tooMany = Array.from({ length: RENDER_MAX_PAGES + 1 }, (_, i) => i + 1)
    expect(renderPdfPages(TEXT_PDF, tooMany)).rejects.toMatchObject({ kind: 'over_limit' })
  })
})

describe('selectPages', () => {
  test('passes explicit pages through', () => {
    expect(selectPages(50, [3, 1])).toEqual({ partial: [3, 1], pagesTruncated: false })
  })

  test('reads everything when under the page cap', () => {
    expect(selectPages(50, undefined)).toEqual({ partial: undefined, pagesTruncated: false })
  })

  test('caps unselected reads at MAX_PDF_PAGES', () => {
    const result = selectPages(MAX_PDF_PAGES + 20, undefined)
    expect(result.pagesTruncated).toBe(true)
    expect(result.partial).toHaveLength(MAX_PDF_PAGES)
    expect(result.partial![0]).toBe(1)
    expect(result.partial![MAX_PDF_PAGES - 1]).toBe(MAX_PDF_PAGES)
  })
})

describe('capPageTexts', () => {
  test('passes short content through untouched', () => {
    const pages = [{ page: 1, text: 'hello' }]
    expect(capPageTexts(pages)).toEqual({ pages, charsTruncated: false })
  })

  test('truncates at the char budget with a visible marker', () => {
    const big = 'x'.repeat(MAX_CHARS)
    const result = capPageTexts([
      { page: 1, text: big },
      { page: 2, text: 'never reached' },
    ])
    expect(result.charsTruncated).toBe(true)
    const total = result.pages.reduce((n, p) => n + p.text.length, 0)
    expect(total).toBeLessThanOrEqual(MAX_CHARS + 100) // marker allowance
    expect(result.pages[result.pages.length - 1]!.text).toContain('[truncated')
    expect(result.pages.some((p) => p.text.includes('never reached'))).toBe(false)
  })
})

describe('PdfError', () => {
  test('is an Error with a kind', () => {
    const err = new PdfError('not_found', 'nope')
    expect(err).toBeInstanceOf(Error)
    expect(err.kind).toBe('not_found')
  })
})
