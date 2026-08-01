/**
 * Brand store engine (#419, spec §3.1/§3.3).
 *
 * Directory-per-brand under ~/.bakin/brands/ with an atomic manifest,
 * per-brand mutation lock, honest corrupt-brand errors (never silently
 * skipped), guideline/lesson doc IO with frontmatter descriptions, a
 * content fingerprint, and scaffolded starter guidelines on create.
 */
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-brand-store-${Date.now()}-${randomUUID()}`)
const paths = () => ({
  home: testDir,
  brands: join(testDir, 'brands'),
  db: join(testDir, 'bakin.db'),
})

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: paths,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: paths,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import {
  createBrand,
  getBrand,
  listBrands,
  saveManifest,
  deleteBrand,
  listDocs,
  readDoc,
  writeDoc,
  deleteDoc,
  addLesson,
} from '../../../plugins/brands/lib/store'
import { computeBrandFingerprint } from '../../../plugins/brands/lib/fingerprint'
import { scaffoldBrand } from '../../../plugins/brands/lib/scaffold'
import { settleFor } from '../../helpers/wait'

beforeEach(() => {
  rmSync(join(testDir, 'brands'), { recursive: true, force: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('brand store CRUD', () => {
  it('creates a brand with timestamps and reads it back', () => {
    const created = createBrand({ id: 'acme', name: 'Acme', description: 'd' })
    expect(created.id).toBe('acme')
    expect(created.createdAt).toBeTruthy()
    expect(existsSync(join(testDir, 'brands', 'acme', 'brand.json'))).toBe(true)

    const read = getBrand('acme')
    expect(read.status).toBe('ok')
    if (read.status === 'ok') expect(read.manifest.name).toBe('Acme')
  })

  it('rejects invalid slugs and duplicate ids', () => {
    expect(() => createBrand({ id: 'Not A Slug', name: 'x' })).toThrow()
    createBrand({ id: 'acme', name: 'Acme' })
    expect(() => createBrand({ id: 'acme', name: 'Again' })).toThrow()
  })

  it('distinguishes missing from corrupt — corrupt is never silently skipped', () => {
    expect(getBrand('ghost').status).toBe('missing')

    mkdirSync(join(testDir, 'brands', 'broken'), { recursive: true })
    writeFileSync(join(testDir, 'brands', 'broken', 'brand.json'), '{ not json')
    const corrupt = getBrand('broken')
    expect(corrupt.status).toBe('invalid')

    createBrand({ id: 'good', name: 'Good' })
    const listed = listBrands()
    expect(listed.brands.map((b) => b.id)).toEqual(['good'])
    expect(listed.invalid.map((b) => b.id)).toEqual(['broken'])
  })

  it('saveManifest replaces validated content, preserves createdAt, bumps updatedAt', async () => {
    const created = createBrand({ id: 'acme', name: 'Acme' })
    await settleFor(2, 'advance the clock so updatedAt is provably later than createdAt')
    const saved = saveManifest({ ...created, name: 'Acme Inc', rules: ['Never use emojis'] })
    expect(saved.name).toBe('Acme Inc')
    expect(saved.createdAt).toBe(created.createdAt)
    expect(saved.updatedAt).not.toBe(created.updatedAt)
    expect(() => saveManifest({ ...saved, id: 'other' })).toThrow() // id immutable / must exist
  })

  it('deletes a brand directory', () => {
    createBrand({ id: 'acme', name: 'Acme' })
    expect(deleteBrand('acme')).toBe(true)
    expect(existsSync(join(testDir, 'brands', 'acme'))).toBe(false)
    expect(deleteBrand('acme')).toBe(false)
  })
})

describe('brand docs', () => {
  it('writes, lists (with frontmatter descriptions), reads, deletes', () => {
    createBrand({ id: 'acme', name: 'Acme' })
    writeDoc('acme', 'guidelines', 'dev.md', '---\ndescription: CSS tokens\n---\n\n# Dev rules\n')
    writeDoc('acme', 'lessons', 'tweet-flop.md', 'No frontmatter here.')

    const guides = listDocs('acme', 'guidelines')
    const dev = guides.find((d) => d.name === 'dev.md')
    expect(dev?.description).toBe('CSS tokens')

    expect(readDoc('acme', 'guidelines', 'dev.md')).toContain('# Dev rules')
    expect(readDoc('acme', 'guidelines', 'nope.md')).toBeNull()

    expect(deleteDoc('acme', 'guidelines', 'dev.md')).toBe(true)
    expect(listDocs('acme', 'guidelines').find((d) => d.name === 'dev.md')).toBeUndefined()
  })

  it('rejects path-escaping doc names', () => {
    createBrand({ id: 'acme', name: 'Acme' })
    expect(() => writeDoc('acme', 'guidelines', '../evil.md', 'x')).toThrow()
    expect(() => writeDoc('acme', 'guidelines', 'no-extension', 'x')).toThrow()
  })

  it('rejects path-escaping brandIds (traversal via the id, not just the name)', () => {
    // read_doc reaches docPath with an agent-supplied brandId — a `../..` must
    // never escape the brands store.
    expect(() => readDoc('../..', 'guidelines', 'x.md')).toThrow(/invalid brand id/)
    expect(() => writeDoc('../../etc', 'lessons', 'x.md', 'y')).toThrow(/invalid brand id/)
  })

  it('addLesson is append-only — never overwrites a same-slug lesson', () => {
    createBrand({ id: 'acme', name: 'Acme' })
    const first = addLesson('acme', 'Never use threads', 'Single posts only.')
    expect(first).toBe('never-use-threads.md')
    const second = addLesson('acme', 'Never use threads', 'A different learning.')
    expect(second).toBe('never-use-threads-2.md')
    expect(readDoc('acme', 'lessons', 'never-use-threads.md')).toContain('Single posts only.')
    expect(readDoc('acme', 'lessons', 'never-use-threads-2.md')).toContain('A different learning.')
  })
})

describe('fingerprint', () => {
  it('is stable across reads and changes on any content edit', () => {
    createBrand({ id: 'acme', name: 'Acme' })
    writeDoc('acme', 'guidelines', 'voice.md', 'Warm, direct.')
    const fp1 = computeBrandFingerprint('acme')
    const fp2 = computeBrandFingerprint('acme')
    expect(fp1).toBe(fp2!)
    expect(fp1).toMatch(/^sha256:[0-9a-f]{64}$/)

    writeDoc('acme', 'guidelines', 'voice.md', 'Warm, direct, slightly irreverent.')
    expect(computeBrandFingerprint('acme')).not.toBe(fp1)

    expect(computeBrandFingerprint('ghost')).toBeNull()
  })
})

describe('scaffold', () => {
  it('seeds starter guidelines once, never overwriting', () => {
    createBrand({ id: 'acme', name: 'Acme' })
    const written = scaffoldBrand('acme')
    expect(written).toContain('guidelines/voice.md')
    expect(written).toContain('guidelines/style-guide.md')
    const voice = readFileSync(join(testDir, 'brands', 'acme', 'guidelines', 'voice.md'), 'utf-8')
    expect(voice.length).toBeGreaterThan(100)

    writeDoc('acme', 'guidelines', 'voice.md', 'MY EDIT')
    expect(scaffoldBrand('acme')).toEqual([]) // second run writes nothing
    expect(readDoc('acme', 'guidelines', 'voice.md')).toBe('MY EDIT')
  })
})

describe('mutation lock', () => {
  it('serializes concurrent manifest mutations per brand', async () => {
    const created = createBrand({ id: 'acme', name: 'Acme' })
    // Two racing read-modify-write saves; without the lock one update is lost.
    const { updateBrand } = await import('../../../plugins/brands/lib/store')
    await Promise.all([
      updateBrand('acme', async (m) => ({ ...m, rules: [...(m.rules ?? []), 'rule-a'] })),
      updateBrand('acme', async (m) => ({ ...m, rules: [...(m.rules ?? []), 'rule-b'] })),
    ])
    const read = getBrand('acme')
    if (read.status !== 'ok') throw new Error('expected ok')
    expect(read.manifest.rules?.sort()).toEqual(['rule-a', 'rule-b'])
    expect(created.rules ?? []).toEqual([])
  })
})
