/**
 * The model-plan recommender (`src/core/model-plan.ts`) is PURE over its
 * input (spec §3.4): the caller pre-resolves vision, lanes, prices and
 * eligibility. It must never reach for the curated vision list, the model
 * catalog, the ledger, or app services itself — the plugin composition
 * (`plugins/models/lib/plan.ts`) owns those lookups, so the recommender stays
 * testable as a table and every consumer (page, onboarding, CLI, health)
 * sees the same verdict for the same input.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const FILE = join(process.cwd(), 'src/core/model-plan.ts')
const ALLOWED_IMPORTS = new Set(['./model-routing', './model-mutations'])

describe('model-plan purity', () => {
  it('imports only the routing/mutation types — no vision list, catalog, ledger or services', () => {
    const src = readFileSync(FILE, 'utf-8')
    const specifiers = [...src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]!)
    expect(specifiers.length).toBeGreaterThan(0)
    expect(specifiers.filter((s) => !ALLOWED_IMPORTS.has(s))).toEqual([])
    expect(src).not.toMatch(/VISION_MODELS|vision-models|model-catalog|execution-ledger|app-services/)
  })
})
