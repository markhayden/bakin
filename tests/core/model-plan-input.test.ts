/**
 * The core plan-input assembler (spec §3.4): lanes from the runtime's
 * credential shapes with operator overrides on top, tier from the row →
 * catalog → id heuristic, vision from `input` → curated list → unknown,
 * ineligible/unavailable/non-LLM rows excluded, and the plugin-free
 * catalog listing (onboarding's path) folding rows through eligibility.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { mkdirSync, rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-plan-input-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }))

import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { closeDb } from '../../packages/core/src/storage/db'
import { assemblePlanInput, listPlanCatalogRows } from '../../src/core/model-plan-input'

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

const LUNA = 'openai-codex/gpt-5.6-luna'
const HAIKU = 'anthropic/claude-haiku-4-5'
const DEAD = 'openai/gpt-6-astra'

function runtime(over: { credentials?: Array<{ provider: string; kind: 'oauth' | 'api-key' }>; throwCredentials?: boolean } = {}): AgentRuntimeAdapter {
  return {
    models: {
      routingPolicy: async () => ({ defaultModel: LUNA, fallbackModels: [], aliases: {} }),
      listAvailable: async () => [
        { id: LUNA, name: 'luna', available: true, input: 'text,image', contextWindow: 400_000 },
        { id: HAIKU, name: 'haiku', available: true },
        { id: DEAD, name: 'astra', available: false, unavailableReason: 'no_credentials' as const },
      ],
    },
    credentials: {
      providers: async () => ({
        evidence: 'complete' as const,
        providers: [{ providerId: 'openai-codex', configured: true }, { providerId: 'anthropic', configured: true }, { providerId: 'openai', configured: false }],
      }),
    },
    credentialStatus: async () => {
      if (over.throwCredentials) throw new Error('cli exploded')
      return { llmProviders: [], channels: [], llmCredentials: over.credentials ?? [{ provider: 'openai-codex', kind: 'oauth' }, { provider: 'anthropic', kind: 'api-key' }] }
    },
  } as unknown as AgentRuntimeAdapter
}

const routing = { routes: [], tagOverrides: [] }

describe('assemblePlanInput', () => {
  it('lanes from credentials, tier from row → catalog → id, vision from input → curated → unknown, price from the catalog', async () => {
    const input = await assemblePlanInput({
      runtime: runtime(),
      routing,
      enrichmentEnabled: true,
      rows: [
        { id: LUNA, input: 'text,image', contextWindow: 400_000 },
        { id: HAIKU, tier: 'budget' },
        { id: 'openai-codex/gpt-5.4-mini' },
        { id: 'mystery/thing', kind: 'image' },
        { id: DEAD, available: false },
        { id: 'anthropic/claude-opus-4-6', eligibility: { status: 'ineligible' } },
      ],
    })
    expect(input.candidates.map((c) => c.id)).toEqual([LUNA, HAIKU, 'openai-codex/gpt-5.4-mini'])
    expect(input.candidates[0]).toMatchObject({ lane: 'subscription', tier: 'premium', vision: true, contextWindow: 400_000 })
    expect(input.candidates[1]).toMatchObject({ lane: 'metered', tier: 'budget', vision: true })
    expect(input.candidates[1]!.pricePer1M).toBeGreaterThan(0)
    expect(input.candidates[2]).toMatchObject({ lane: 'subscription', tier: 'budget', vision: null })
    expect(input.currentDefaultModel).toBe(LUNA)
  })

  it('an operator override beats detection; a credentials failure leaves lanes metered and never throws', async () => {
    const overridden = await assemblePlanInput({ runtime: runtime(), routing, enrichmentEnabled: true, rows: [{ id: HAIKU }], billingOverrides: [{ provider: 'anthropic', lane: 'subscription' }] })
    expect(overridden.candidates[0]!.lane).toBe('subscription')
    const failed = await assemblePlanInput({ runtime: runtime({ throwCredentials: true }), routing, enrichmentEnabled: true, rows: [{ id: LUNA }] })
    expect(failed.candidates[0]!.lane).toBe('metered')
  })
})

describe('listPlanCatalogRows', () => {
  it('lists the runtime catalog with eligibility folded in — a no-credentials row stays listed but ineligible', async () => {
    const rows = await listPlanCatalogRows(runtime())
    expect(rows.map((r) => r.id)).toEqual([LUNA, HAIKU, DEAD])
    expect(rows[0]).toMatchObject({ input: 'text,image', contextWindow: 400_000, eligibility: { status: 'eligible' } })
    expect(rows[2]).toMatchObject({ available: false, eligibility: { status: 'ineligible' } })
    const input = await assemblePlanInput({ runtime: runtime(), routing, enrichmentEnabled: true, rows })
    expect(input.candidates.map((c) => c.id)).toEqual([LUNA, HAIKU])
  })
})
