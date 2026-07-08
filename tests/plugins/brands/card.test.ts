/**
 * Brand card builder (#419, spec §5.1/§5.2/§5.5).
 *
 * Tiered, byte-budgeted, whole-unit retention: header + anti-bleed + rules +
 * palette + terminology + listings ALWAYS survive; inline cardDocs then
 * lessons fill the remaining budget; every drop leaves a visible marker.
 * Injection-record meta reports exactly what was included/omitted.
 */
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-brand-card-${Date.now()}-${randomUUID()}`)
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

import { buildBrandCard } from '../../../plugins/brands/lib/card'
import { createBrand, saveManifest, writeDoc, deleteBrand } from '../../../plugins/brands/lib/store'

beforeEach(() => {
  rmSync(join(testDir, 'brands'), { recursive: true, force: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function seedAcme() {
  const created = createBrand({ id: 'acme', name: 'Acme' })
  saveManifest({
    ...created,
    palette: [{ name: 'ink', hex: '#1A1A2E', usage: 'primary text' }],
    rules: ['Never use emojis', 'Never say "delish"'],
    terminology: [{ term: 'the Acme app', rule: 'never "our tool"' }],
    logos: [{ assetId: 'asset-logo-dark', variant: 'dark' }],
    assetGroups: [
      { name: 'app-screenshots', description: 'real product UI', assetIds: ['asset-shot-1'] },
    ],
    defaultImageReferences: ['asset-logo-dark'],
  })
  writeDoc('acme', 'guidelines', 'voice.md', '---\ndescription: how we talk\n---\n\nWarm, direct, slightly irreverent.')
  writeDoc('acme', 'guidelines', 'style-guide.md', '---\ndescription: visual rules\n---\n\nLots of visual rules here.')
}

describe('buildBrandCard', () => {
  it('returns notFound for missing and draft brands', async () => {
    expect(await buildBrandCard('ghost', { maxBytes: 12288 })).toEqual({ notFound: true })
    createBrand({ id: 'wip', name: 'WIP', draft: true })
    expect(await buildBrandCard('wip', { maxBytes: 12288 })).toEqual({ notFound: true })
  })

  it('builds the full tiered card with meta', async () => {
    seedAcme()
    const result = await buildBrandCard('acme', { maxBytes: 12288 })
    if ('notFound' in result) throw new Error('expected card')
    const { card, meta } = result

    // Tier 1: header + compliance + anti-bleed
    expect(card).toContain('Brand: Acme (acme)')
    expect(card).toContain('MUST follow this brand')
    expect(card).toMatch(/ONLY this brand/i)
    // Tier 2: rules always inline, palette, terminology
    expect(card).toContain('Never use emojis')
    expect(card).toContain('#1A1A2E')
    expect(card).toContain('the Acme app')
    // Tier 3: doc listing with descriptions + assets + image-tool instruction
    expect(card).toContain('style-guide.md')
    expect(card).toContain('visual rules')
    expect(card).toContain('bakin_exec_brands_read_doc')
    expect(card).toContain('app-screenshots')
    expect(card).toContain('asset-shot-1')
    expect(card).toContain('brandId')
    // Tier 4: voice.md inlined by default cardDocs
    expect(card).toContain('slightly irreverent')

    expect(meta.brandId).toBe('acme')
    expect(meta.brandFingerprint).toMatch(/^sha256:/)
    expect(meta.cardBytes).toBe(Buffer.byteLength(card, 'utf-8'))
    expect(meta.omitted).toEqual([])
    expect(meta.sectionsIncluded).toContain('voice.md')
  })

  it('drops inline docs whole with visible markers under a tight budget — rules always survive', async () => {
    seedAcme()
    writeDoc('acme', 'guidelines', 'voice.md', 'X'.repeat(6000))
    const result = await buildBrandCard('acme', { maxBytes: 1024 })
    if ('notFound' in result) throw new Error('expected card')

    // Always-tiers survive even past the budget
    expect(result.card).toContain('Never use emojis')
    expect(result.card).toContain('#1A1A2E')
    // The oversized doc is dropped whole, never truncated mid-content
    expect(result.card).not.toContain('XXXX')
    expect(result.card).toContain('omitted')
    expect(result.meta.omitted.map((o) => o.item)).toContain('voice.md')
    expect(result.meta.sectionsIncluded).not.toContain('voice.md')
  })

  it('renders lessons when provided and a visible marker when unavailable', async () => {
    seedAcme()
    const withLessons = await buildBrandCard('acme', {
      maxBytes: 12288,
      lessons: [{ name: 'tweet-flops.md', body: 'Do not post threads on Friday.' }],
    })
    if ('notFound' in withLessons) throw new Error('expected card')
    expect(withLessons.card).toContain('Do not post threads on Friday.')
    expect(withLessons.meta.lessonsIncluded).toEqual(['tweet-flops.md'])

    const down = await buildBrandCard('acme', { maxBytes: 12288, lessonsUnavailable: true })
    if ('notFound' in down) throw new Error('expected card')
    expect(down.card).toContain('brand lessons unavailable')
  })

  it('flags dangling asset references as warnings + card markers', async () => {
    seedAcme()
    const result = await buildBrandCard('acme', {
      maxBytes: 12288,
      assetExists: async (id) => id !== 'asset-shot-1',
    })
    if ('notFound' in result) throw new Error('expected card')
    expect(result.warnings.join(' ')).toContain('asset-shot-1')
    expect(result.card).toContain('missing')
  })

  it('handles a skeletal brand honestly (small card, no fabricated sections)', async () => {
    createBrand({ id: 'bare', name: 'Bare' })
    const result = await buildBrandCard('bare', { maxBytes: 12288 })
    if ('notFound' in result) throw new Error('expected card')
    expect(result.card).toContain('Brand: Bare (bare)')
    expect(result.card).not.toContain('Palette')
    expect(result.card).not.toContain('Rules')
    expect(result.meta.cardBytes).toBeLessThan(1200)
    deleteBrand('bare')
  })
})
