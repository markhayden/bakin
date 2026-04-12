/**
 * Unit coverage for the server-side content extractor. Focuses on the
 * decision logic (which extension routes to which extractor), graceful
 * failure on unreadable files, and the size cap.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock pdf-parse — the real one needs a valid PDF. For unit tests we
// just need to prove extractAssetContent ROUTES to the PDF branch and
// surfaces whatever text the library returns. pdf-parse v2 exports a
// PDFParse class with getText() and destroy() methods, so the mock
// stands up a matching class.
vi.mock('pdf-parse', () => {
  class MockPDFParse {
    private byteLen: number
    constructor(options: { data: Uint8Array }) {
      this.byteLen = options.data.length
    }
    async getText() {
      return {
        text: `pdf-parse returned ${this.byteLen} bytes of fake text: tzatziki Worcestershire`,
      }
    }
    async destroy() {}
  }
  return { PDFParse: MockPDFParse }
})

// Logger mock — silences warnings during tests and avoids the real
// logger's globalThis side effects.
vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { extractAssetContent } from '../../../plugins/assets/lib/content-extractor'

const testDir = join(tmpdir(), `bakin-test-content-extractor-${Date.now()}`)

describe('extractAssetContent', () => {
  beforeAll(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    mkdirSync(testDir, { recursive: true })
  })

  afterAll(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
  })

  it('reads .md files with fs.readFileSync and returns body text', async () => {
    const path = join(testDir, 'notes.md')
    writeFileSync(path, '# Bread Recipe\n\nautolyse, banneton, bulk fermentation')
    const content = await extractAssetContent(path, 'notes.md')
    expect(content).toContain('autolyse')
    expect(content).toContain('banneton')
    expect(content).toContain('# Bread Recipe')
  })

  it('reads .txt files as plain text', async () => {
    const path = join(testDir, 'raw.txt')
    writeFileSync(path, 'this is a plain text asset')
    expect(await extractAssetContent(path, 'raw.txt')).toContain('plain text asset')
  })

  it('reads .json files as text (not parsed)', async () => {
    const path = join(testDir, 'config.json')
    writeFileSync(path, '{"key": "value"}')
    expect(await extractAssetContent(path, 'config.json')).toContain('"key"')
  })

  it('reads .yaml and .yml', async () => {
    const pathA = join(testDir, 'a.yaml')
    const pathB = join(testDir, 'b.yml')
    writeFileSync(pathA, 'foo: bar')
    writeFileSync(pathB, 'baz: qux')
    expect(await extractAssetContent(pathA, 'a.yaml')).toContain('foo: bar')
    expect(await extractAssetContent(pathB, 'b.yml')).toContain('baz: qux')
  })

  it('routes .pdf files through the pdf-parse library', async () => {
    const path = join(testDir, 'doc.pdf')
    writeFileSync(path, 'fake-pdf-bytes')
    const content = await extractAssetContent(path, 'doc.pdf')
    expect(content).toContain('pdf-parse returned')
    expect(content).toContain('tzatziki')
  })

  it('returns empty string for unsupported extensions', async () => {
    const path = join(testDir, 'binary.bin')
    writeFileSync(path, 'opaque-bytes')
    expect(await extractAssetContent(path, 'binary.bin')).toBe('')
  })

  it('returns empty string and does not throw when the file is missing', async () => {
    const path = join(testDir, 'does-not-exist.md')
    await expect(extractAssetContent(path, 'does-not-exist.md')).resolves.toBe('')
  })

  it('truncates content longer than the 50K char cap', async () => {
    const path = join(testDir, 'huge.txt')
    // 80K chars — 30K over the cap
    const big = 'a'.repeat(80_000)
    writeFileSync(path, big)
    const content = await extractAssetContent(path, 'huge.txt')
    expect(content.length).toBeLessThanOrEqual(50_000)
  })

  it('is case-insensitive on extension', async () => {
    const path = join(testDir, 'UPPER.MD')
    writeFileSync(path, 'case insensitive test')
    expect(await extractAssetContent(path, 'UPPER.MD')).toContain('case insensitive')
  })
})
