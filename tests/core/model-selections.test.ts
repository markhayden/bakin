/**
 * Persisted model selections (#907): enumerate every reference, hash them
 * into ONE revision, and propose repairs for the dead ones — same-id under
 * a credentialed provider first, the lane recommender second, honest null
 * third. Nothing here writes.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-selections-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { createMockRuntimeAdapter } from '../../packages/core/src/adapters/runtime/testing'
import type { RoutingConfig } from '../../src/core/model-routing'
import type { EligibilityReport } from '../../src/core/model-eligibility'
import {
  computeRevision,
  documentOf,
  enumerateSelections,
  mapModelToCatalog,
  proposeRepairs,
} from '../../src/core/model-selections'

function runtimeWith(opts: { agents?: Array<{ id: string; model?: string; subagentModel?: string }>; policy?: Partial<{ defaultModel: string; fallbackModels: string[]; defaultSubagentModel: string | null; aliases: Record<string, string> }> }) {
  const base = createMockRuntimeAdapter()
  return {
    ...base,
    agents: {
      ...base.agents,
      list: async () => (opts.agents ?? []).map((a) => ({ id: a.id, name: a.id, model: a.model, subagentModel: a.subagentModel })),
    },
    models: {
      ...base.models,
      routingPolicy: async () => ({
        defaultModel: opts.policy?.defaultModel ?? 'openai-codex/gpt-5.5',
        fallbackModels: opts.policy?.fallbackModels ?? [],
        defaultSubagentModel: opts.policy?.defaultSubagentModel ?? null,
        aliases: opts.policy?.aliases ?? {},
      }),
    },
  }
}

const routing: RoutingConfig = {
  routes: [
    { workClass: 'enrichment', model: 'openai-codex/gpt-6-astra', thinking: 'low' },
    { workClass: 'recovery', thinking: 'high' },
  ],
  tagOverrides: [{ tag: 'legal', model: 'openai/gpt-5.6-sol' }],
}

describe('enumerateSelections', () => {
  it('walks policy, roster, routes, tags and ui mode into stable refs with documents', async () => {
    const runtime = runtimeWith({
      agents: [{ id: 'main' }, { id: 'enrich', model: 'openai/gpt-5.6-luna' }],
      policy: { defaultModel: 'openai-codex/gpt-5.5', fallbackModels: ['openai-codex/gpt-6-astra'], aliases: { fast: 'openai-codex/gpt-6-astra' } },
    })
    const states = await enumerateSelections(runtime, { routing, uiMode: 'advanced' })
    const byRef = new Map(states.map((s) => [s.ref, s]))
    expect(byRef.get('policy:defaultModel')).toMatchObject({ model: 'openai-codex/gpt-5.5', document: 'policy' })
    expect(byRef.get('policy:fallback:0')).toMatchObject({ model: 'openai-codex/gpt-6-astra', document: 'policy' })
    expect(byRef.get('policy:alias:fast')).toMatchObject({ model: 'openai-codex/gpt-6-astra', document: 'policy' })
    expect(byRef.get('agent:main:model')).toMatchObject({ model: null, document: 'agent:main' })
    expect(byRef.get('agent:enrich:model')).toMatchObject({ model: 'openai/gpt-5.6-luna', document: 'agent:enrich' })
    expect(byRef.get('route:enrichment')).toMatchObject({ model: 'openai-codex/gpt-6-astra', thinking: 'low', document: 'routing' })
    expect(byRef.get('route:recovery')).toMatchObject({ model: null, thinking: 'high' })
    expect(byRef.get('tag:legal')).toMatchObject({ model: 'openai/gpt-5.6-sol', document: 'routing' })
    expect(byRef.get('ui:mode')).toMatchObject({ model: 'advanced', document: 'routing' })
    // Every routable class has a ref even when unrouted (so a save can target it).
    expect(byRef.has('route:scheduled')).toBe(true)
    expect(byRef.has('route:chat')).toBe(false)
  })

  it('documentOf maps every ref family to its write boundary', () => {
    expect(documentOf('policy:defaultModel')).toBe('policy')
    expect(documentOf('policy:alias:fast')).toBe('policy')
    expect(documentOf('agent:enrich:subagentModel')).toBe('agent:enrich')
    expect(documentOf('route:enrichment')).toBe('routing')
    expect(documentOf('tag:legal')).toBe('routing')
    expect(documentOf('ui:mode')).toBe('routing')
  })
})

describe('computeRevision', () => {
  const base = [
    { ref: 'policy:defaultModel', model: 'a', document: 'policy' as const, label: '' },
    { ref: 'route:enrichment', model: 'b', thinking: 'low' as const, document: 'routing' as const, label: '' },
    { ref: 'policy:fallback:0', model: 'c', document: 'policy' as const, label: '' },
    { ref: 'policy:fallback:1', model: 'd', document: 'policy' as const, label: '' },
  ]

  it('is stable across ordering and changes on model, thinking, fallback order, or mode', () => {
    const r0 = computeRevision(base)
    expect(computeRevision([...base].reverse())).toBe(r0)
    expect(computeRevision(base.map((s) => (s.ref === 'route:enrichment' ? { ...s, thinking: 'high' as const } : s)))).not.toBe(r0)
    expect(computeRevision(base.map((s) => (s.ref === 'policy:defaultModel' ? { ...s, model: 'z' } : s)))).not.toBe(r0)
    const swapped = base.map((s) => (s.ref === 'policy:fallback:0' ? { ...s, model: 'd' } : s.ref === 'policy:fallback:1' ? { ...s, model: 'c' } : s))
    expect(computeRevision(swapped)).not.toBe(r0)
    expect(computeRevision([...base, { ref: 'ui:mode', model: 'simple', document: 'routing' as const, label: '' }])).not.toBe(r0)
  })
})

describe('mapModelToCatalog (shared same-id helper)', () => {
  it('exact → unique bare → null', () => {
    expect(mapModelToCatalog('openai/gpt-5.5', ['openai/gpt-5.5', 'openai-codex/gpt-5.5'])).toBe('openai/gpt-5.5')
    expect(mapModelToCatalog('openai/gpt-5.5', ['openai-codex/gpt-5.5', 'google/gemini-flash'])).toBe('openai-codex/gpt-5.5')
    expect(mapModelToCatalog('openai/gpt-5.5', ['openai-codex/gpt-5.5', 'azure/gpt-5.5'])).toBeNull()
  })
})

function report(entries: Record<string, { status: 'eligible' } | { status: 'ineligible'; reason: 'no_credentials' | 'account_rejected' | 'runtime_unavailable' | 'not_in_catalog'; detail: string } | { status: 'unknown'; detail: string }>): EligibilityReport {
  const byModel = new Map<string, { eligibility: (typeof entries)[string]; facts: never }>()
  for (const [id, eligibility] of Object.entries(entries)) byModel.set(id, { eligibility, facts: {} as never })
  return { byModel: byModel as never, evidence: { catalog: 'ok', runtimeAvailability: 'ok', credentials: 'ok', rejections: 'ok' }, epoch: 0 }
}

describe('proposeRepairs', () => {
  const states = [
    { ref: 'agent:enrich:model', model: 'openai/gpt-5.6-luna', document: 'agent:enrich' as const, label: "H'enrich" },
    { ref: 'route:relay', model: 'openai-codex/gpt-4.9-retired', document: 'routing' as const, label: 'Relay' },
    { ref: 'policy:defaultModel', model: 'openai-codex/gpt-5.5', document: 'policy' as const, label: 'Default model' },
    { ref: 'tag:legal', model: 'x/unverified', document: 'routing' as const, label: 'legal' },
  ]
  const rep = report({
    'openai/gpt-5.6-luna': { status: 'ineligible', reason: 'no_credentials', detail: 'no credentials for openai' },
    'openai-codex/gpt-5.6-luna': { status: 'eligible' },
    'openai-codex/gpt-4.9-retired': { status: 'ineligible', reason: 'not_in_catalog', detail: 'gone' },
    'openai-codex/gpt-5.5': { status: 'eligible' },
    'openai-codex/gpt-6-astra': { status: 'eligible' },
    'x/unverified': { status: 'unknown', detail: "couldn't verify" },
  })

  it('same model id under a credentialed provider wins (the #907 fix), else the recommender, else null', () => {
    const proposals = proposeRepairs(states, rep, { recommendFor: (ref) => (ref === 'route:relay' ? 'openai-codex/gpt-6-astra' : null), revision: 'r1' })
    expect(proposals).toHaveLength(2)
    expect(proposals.find((p) => p.ref === 'agent:enrich:model')).toEqual({
      ref: 'agent:enrich:model', from: 'openai/gpt-5.6-luna', to: 'openai-codex/gpt-5.6-luna',
      reason: 'no credentials for openai', source: 'same-id-credentialed-provider', revision: 'r1',
    })
    expect(proposals.find((p) => p.ref === 'route:relay')).toMatchObject({ to: 'openai-codex/gpt-6-astra', source: 'recommender' })
  })

  it('an unknown-eligibility selection never gets a proposal; no candidate ⇒ to: null with source none', () => {
    const proposals = proposeRepairs(states, rep, { recommendFor: () => null, revision: 'r1' })
    expect(proposals.some((p) => p.ref === 'tag:legal')).toBe(false)
    expect(proposals.find((p) => p.ref === 'route:relay')).toMatchObject({ to: null, source: 'none' })
  })
})
