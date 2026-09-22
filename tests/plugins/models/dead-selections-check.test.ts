/**
 * models.dead-selections (#907): one action_required finding per persisted
 * selection that cannot run, with a one-click repair carrying the EXACT
 * {ref, from, to, revision} the operator saw (refused if stale). Missing
 * evidence is ONE unknown finding per source, never per-selection noise.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-dead-selections-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }) }))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { checkDeadSelections, deadSelectionRepair, type DeadSelectionDeps, type SelectionsDescription } from '../../../plugins/models/lib/dead-selections'
import type { Proposal } from '../../../src/core/model-selections'

const DEAD = 'openai/gpt-5.6-luna'
const FIX = 'openai-codex/gpt-5.6-luna'

function description(over: Partial<SelectionsDescription> = {}): SelectionsDescription {
  return {
    revision: 'rev-1',
    states: [
      { ref: 'policy:defaultModel', model: 'openai-codex/gpt-5.5', document: 'policy', label: 'Default model', eligibility: { status: 'eligible' } },
      { ref: 'agent:enrich:model', model: DEAD, document: 'agent:enrich', label: "H'enrich", eligibility: { status: 'ineligible', reason: 'no_credentials', detail: 'no credentials for openai' } },
      { ref: 'route:relay', model: 'openai-codex/gpt-4.9-retired', document: 'routing', label: 'relay', eligibility: { status: 'ineligible', reason: 'not_in_catalog', detail: 'gone' } },
      { ref: 'tag:legal', model: 'x/unverified', document: 'routing', label: 'legal', eligibility: { status: 'unknown', detail: "couldn't verify credentialed" } },
    ],
    proposals: [
      { ref: 'agent:enrich:model', from: DEAD, to: FIX, reason: 'no credentials for openai', source: 'same-id-credentialed-provider', revision: 'rev-1' },
      { ref: 'route:relay', from: 'openai-codex/gpt-4.9-retired', to: null, reason: 'gone', source: 'none', revision: 'rev-1' },
    ],
    pending: [],
    evidence: { catalog: 'ok', runtimeAvailability: 'ok', credentials: 'ok', rejections: 'ok' },
    ...over,
  }
}

function deps(desc: SelectionsDescription, applied: Proposal[] = []): DeadSelectionDeps {
  return {
    describe: async () => desc,
    apply: async (proposal) => {
      applied.push(proposal)
      return { applied: [proposal.ref], failed: [], pending: [], warnings: [], revision: 'rev-2' }
    },
  }
}

describe('checkDeadSelections', () => {
  it('one action_required finding per dead selection, class service_failure, selection resource; unknown selections are not findings', async () => {
    const result = await checkDeadSelections(deps(description()))
    if (result.outcome !== 'observed') throw new Error('expected observed')
    const keys = result.observations.map((o) => o.key)
    expect(keys).toContain('dead-selection:agent:enrich:model')
    expect(keys).toContain('dead-selection:route:relay')
    expect(keys.some((k) => k.includes('tag:legal'))).toBe(false)

    const enrich = result.observations.find((o) => o.key === 'dead-selection:agent:enrich:model')!
    expect(enrich.status).toBe('error')
    expect(enrich.summary).toContain("H'enrich")
    expect(enrich.summary).toContain('no credentials for openai')
    expect(enrich.incident).toMatchObject({
      class: 'service_failure',
      disposition: 'action_required',
      resources: [{ kind: 'model_selection', id: 'agent:enrich:model' }],
      resolution: { type: 'repair', actionId: 'apply-model-proposal' },
    })
    expect(enrich.evidence).toMatchObject({ ref: 'agent:enrich:model', from: DEAD, to: FIX, revision: 'rev-1' })

    // No proposal ⇒ navigate to the page with the ref highlighted.
    const relay = result.observations.find((o) => o.key === 'dead-selection:route:relay')!
    expect(relay.incident?.resolution).toMatchObject({ type: 'navigate', href: '/models?ref=route%3Arelay' })
  })

  it('healthy when nothing is dead', async () => {
    const desc = description({ states: [description().states[0]!], proposals: [] })
    const result = await checkDeadSelections(deps(desc))
    if (result.outcome !== 'observed') throw new Error('expected observed')
    expect(result.observations.every((o) => o.status === 'healthy')).toBe(true)
  })

  it('failed evidence ⇒ ONE unknown finding per failed source, and selections that depend on it are not condemned', async () => {
    const desc = description({
      evidence: { catalog: 'ok', runtimeAvailability: 'ok', credentials: 'failed', rejections: 'ok' },
      states: [
        description().states[0]!,
        { ref: 'agent:enrich:model', model: DEAD, document: 'agent:enrich', label: "H'enrich", eligibility: { status: 'unknown', detail: "couldn't verify credentialed" } },
      ],
      proposals: [],
    })
    const result = await checkDeadSelections(deps(desc))
    if (result.outcome !== 'observed') throw new Error('expected observed')
    const unknowns = result.observations.filter((o) => o.status === 'unknown')
    expect(unknowns).toHaveLength(1)
    expect(unknowns[0]!.key).toBe('evidence:credentials')
    expect(result.observations.some((o) => o.key.startsWith('dead-selection:'))).toBe(false)
  })
})

describe('deadSelectionRepair', () => {
  it('plans one item per targeted incident with the displayed proposal, and applies exactly that', async () => {
    const applied: Proposal[] = []
    const repair = deadSelectionRepair(deps(description(), applied))
    const items = await repair.plan({ type: 'incidents', reportId: 'r1', ids: ['models:models:dead-selection:agent:enrich:model', 'models:models:dead-selection:route:relay'] })
    // relay has no proposal (to: null) ⇒ nothing to apply for it.
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ actionId: 'apply-model-proposal', safety: 'safe', incidentIds: ['models:models:dead-selection:agent:enrich:model'] })
    expect(items[0]!.changes[0]!.description).toContain(FIX)

    const results = await repair.apply(items)
    expect(results[0]).toMatchObject({ status: 'applied', affectedCheckIds: ['models.dead-selections'] })
    expect(applied).toEqual([{ ref: 'agent:enrich:model', from: DEAD, to: FIX, reason: 'no credentials for openai', source: 'same-id-credentialed-provider', revision: 'rev-1' }])
  })

  it('reports failed when the mutation refuses (stale revision / write pending)', async () => {
    const d: DeadSelectionDeps = { describe: async () => description(), apply: async () => { throw Object.assign(new Error('the configuration changed'), { code: 'stale_revision', status: 409 }) } }
    const repair = deadSelectionRepair(d)
    const items = await repair.plan({ type: 'incidents', reportId: 'r1', ids: ['models:models:dead-selection:agent:enrich:model'] })
    const results = await repair.apply(items)
    expect(results[0]).toMatchObject({ status: 'failed' })
    expect(results[0]!.message).toContain('configuration changed')
  })
})
