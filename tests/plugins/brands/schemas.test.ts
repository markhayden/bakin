/**
 * Brand manifest + portable schemas (#419, spec §3.2/§3.4).
 *
 * The manifest is the sole structured source of truth; everything agents
 * read is markdown. The portable schema is the repo-shaped variant with
 * relative file paths instead of machine-local assetIds.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure zod module — but mock the resolvers anyway per house isolation rules
// so a future import chain can never reach the real ~/.bakin.
const testDir = join(tmpdir(), `bakin-test-brand-schemas-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, brands: join(testDir, 'brands'), db: join(testDir, 'bakin.db') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, brands: join(testDir, 'brands'), db: join(testDir, 'bakin.db') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import {
  brandIdSchema,
  brandManifestSchema,
  portableBrandSchema,
} from '../../../plugins/brands/lib/schemas'

const validManifest = {
  id: 'acme',
  name: 'Acme',
  description: 'The Acme brand',
  palette: [{ name: 'ink', hex: '#1A1A2E', usage: 'primary text' }],
  rules: ['Never use emojis'],
  terminology: [{ term: 'the Acme app', rule: 'never "our tool"' }],
  logos: [{ assetId: '20250601-logo-dark-a1b2c3', variant: 'dark' }],
  assetGroups: [
    { name: 'app-screenshots', description: 'real product UI', assetIds: ['20250612-shot-d4e5f6'] },
  ],
  defaultImageReferences: ['20250601-logo-dark-a1b2c3'],
  cardDocs: ['voice.md'],
  createdAt: '2026-07-08T00:00:00.000Z',
  updatedAt: '2026-07-08T00:00:00.000Z',
}

describe('brandIdSchema', () => {
  it('accepts kebab-case slugs', () => {
    for (const id of ['acme', 'loaf-ladle', 'brand2', 'a1-b2']) {
      expect(brandIdSchema.safeParse(id).success).toBe(true)
    }
  })

  it('rejects non-slug ids', () => {
    for (const id of ['', 'Acme', 'has space', '-leading', 'trailing-', 'dots.here', 'a'.repeat(65)]) {
      expect(brandIdSchema.safeParse(id).success).toBe(false)
    }
  })
})

describe('brandManifestSchema', () => {
  it('accepts a full valid manifest', () => {
    const parsed = brandManifestSchema.safeParse(validManifest)
    expect(parsed.success).toBe(true)
  })

  it('accepts a minimal manifest (id + name + timestamps)', () => {
    const parsed = brandManifestSchema.safeParse({
      id: 'min',
      name: 'Minimal',
      palette: [],
      logos: [],
      assetGroups: [],
      createdAt: validManifest.createdAt,
      updatedAt: validManifest.updatedAt,
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects bad hex colors, bad ids, and >4 default image references', () => {
    expect(
      brandManifestSchema.safeParse({
        ...validManifest,
        palette: [{ name: 'ink', hex: 'blueish' }],
      }).success,
    ).toBe(false)
    expect(brandManifestSchema.safeParse({ ...validManifest, id: 'Not A Slug' }).success).toBe(false)
    expect(
      brandManifestSchema.safeParse({
        ...validManifest,
        defaultImageReferences: ['a', 'b', 'c', 'd', 'e'],
      }).success,
    ).toBe(false)
  })

  it('accepts draft + provenance fields', () => {
    const parsed = brandManifestSchema.safeParse({
      ...validManifest,
      draft: true,
      source: { repo: 'github:me/acme-brand', commit: 'abc123', importedAt: validManifest.createdAt },
    })
    expect(parsed.success).toBe(true)
  })
})

describe('portableBrandSchema', () => {
  it('accepts file-path refs and rejects assetId-shaped manifests', () => {
    const portable = {
      id: 'acme',
      name: 'Acme',
      palette: validManifest.palette,
      rules: validManifest.rules,
      logos: [{ file: 'assets/logo-dark.png', variant: 'dark' }],
      assetGroups: [{ name: 'app-screenshots', files: ['assets/shot1.png'] }],
      defaultImageReferences: ['assets/logo-dark.png'],
    }
    expect(portableBrandSchema.safeParse(portable).success).toBe(true)
    // assetId-shaped logo refs are the INSTALLED shape, not portable
    expect(
      portableBrandSchema.safeParse({ ...portable, logos: validManifest.logos }).success,
    ).toBe(false)
  })
})
