/**
 * Kit-completeness contract (brands UX cleanup spec §9.1).
 *
 * Pure-function pins: an empty brand scores 0, scaffold-only guideline docs do
 * NOT count as authored content, and a full kit scores 100 with no missing
 * keys. The checklist keys are a UI contract (cards tooltip + Overview jump
 * links) — renaming one is a breaking change to the brands UI.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure-function test — no storage access. Defensive content-dir mocks per the
// repo's test-isolation convention.
const testDir = join(tmpdir(), 'bakin-test-brand-completeness')
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, brands: join(testDir, 'brands') }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, brands: join(testDir, 'brands') }) }))

import { computeCompleteness, summarizeCompleteness } from '../../../plugins/brands/lib/completeness'
import type { BrandManifest } from '../../../plugins/brands/lib/schemas'

const base: BrandManifest = {
  id: 'acme',
  name: 'Acme',
  palette: [],
  logos: [],
  assetGroups: [],
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
}

// Mirrors the shape of lib/scaffold.ts templates: frontmatter + headings +
// HTML comments only — zero authored prose.
const SCAFFOLD_LIKE = `---
description: How this brand talks
---

# Voice & Tone

<!-- Describe how the brand talks. Three adjectives is a great start. -->

## Personality

<!-- Who is the brand if it were a person? What does it care about? -->
`

const AUTHORED = `---
description: How this brand talks
---

# Voice & Tone

Acme speaks like a sharp friend who happens to be an expert. Direct, warm,
never corporate. We explain jargon on first use and never oversell.
`

describe('computeCompleteness', () => {
  it('empty brand: 0%, all eight keys missing', () => {
    const c = computeCompleteness(base, { voice: null, styleGuide: null })
    expect(c.percent).toBe(0)
    expect(c.items).toHaveLength(8)
    expect(summarizeCompleteness(c).missing).toEqual([
      'logo',
      'palette',
      'description',
      'voice',
      'style-guide',
      'rules',
      'terminology',
      'reference-assets',
    ])
  })

  it('scaffold-only docs do not count as authored', () => {
    const c = computeCompleteness(base, { voice: SCAFFOLD_LIKE, styleGuide: SCAFFOLD_LIKE })
    const byKey = Object.fromEntries(c.items.map((i) => [i.key, i.done]))
    expect(byKey.voice).toBe(false)
    expect(byKey['style-guide']).toBe(false)
  })

  it('authored docs count', () => {
    const c = computeCompleteness(base, { voice: AUTHORED, styleGuide: AUTHORED })
    const byKey = Object.fromEntries(c.items.map((i) => [i.key, i.done]))
    expect(byKey.voice).toBe(true)
    expect(byKey['style-guide']).toBe(true)
  })

  it('full kit: 100%, nothing missing', () => {
    const full: BrandManifest = {
      ...base,
      description: 'Developer tools for sharp teams.',
      palette: [
        { name: 'Primary', hex: '#ff5a00' },
        { name: 'Ink', hex: '#111111' },
        { name: 'Paper', hex: '#fafafa' },
      ],
      rules: ['Never use exclamation marks in headlines.'],
      terminology: [{ term: 'workspace', rule: 'never "dashboard"' }],
      logos: [{ assetId: 'logo-1', variant: 'primary' }],
      assetGroups: [{ name: 'product', assetIds: ['shot-1'] }],
    }
    const c = computeCompleteness(full, { voice: AUTHORED, styleGuide: AUTHORED })
    expect(c.percent).toBe(100)
    expect(summarizeCompleteness(c).missing).toEqual([])
  })

  it('defaultImageReferences alone satisfy reference-assets', () => {
    const c = computeCompleteness(
      { ...base, defaultImageReferences: ['ref-1'] },
      { voice: null, styleGuide: null },
    )
    expect(c.items.find((i) => i.key === 'reference-assets')?.done).toBe(true)
  })

  it('percent is proportional (2 of 8 = 25)', () => {
    const c = computeCompleteness(
      { ...base, description: 'x', rules: ['y'] },
      { voice: null, styleGuide: null },
    )
    expect(c.percent).toBe(25)
  })

  it('every item carries a hint and a fixTab jump target', () => {
    const c = computeCompleteness(base, { voice: null, styleGuide: null })
    for (const item of c.items) {
      expect(item.hint.length).toBeGreaterThan(10)
      expect(['identity', 'guidelines', 'assets']).toContain(item.fixTab)
    }
  })
})
