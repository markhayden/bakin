/**
 * Unit coverage for the server-side content extractor. Focuses on the
 * decision logic (which extension routes to which extractor), graceful
 * failure on unreadable files, and the size cap.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

const isolationDir = join(tmpdir(), `bakin-test-content-extractor-home-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => isolationDir,
  getBakinPaths: () => ({ db: join(isolationDir, 'bakin.db'), bin: join(isolationDir, 'bin') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => isolationDir,
  getBakinPaths: () => ({ db: join(isolationDir, 'bakin.db'), bin: join(isolationDir, 'bin') }),
}))

// Logger mock — silences warnings during tests and avoids the real
// logger's globalThis side effects.
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
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

  it('routes .pdf files through the core PDF engine (real fixture)', async () => {
    const fixture = join(import.meta.dir, '../../fixtures/pdf/text.pdf')
    const content = await extractAssetContent(fixture, 'text.pdf')
    expect(content).toContain('BAKIN FIXTURE PAGE ONE')
    expect(content).toContain('alpha-7291')
    expect(content).toContain('omega-3348') // both pages joined
  })

  it('returns empty string for a non-PDF masquerading as .pdf', async () => {
    const path = join(testDir, 'doc.pdf')
    writeFileSync(path, 'fake-pdf-bytes')
    // Engine rejects by magic bytes; the extractor's never-throws contract
    // degrades that to metadata-only indexing.
    expect(await extractAssetContent(path, 'doc.pdf')).toBe('')
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
