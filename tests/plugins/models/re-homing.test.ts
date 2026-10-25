/**
 * Re-homing table rows 151–159 (models): clamps and unprovable premium routes
 * are observations; routable findings and dead selections with a proposal
 * carry one-click repairs (a routing change widens authorization); a dead
 * selection without a proposal is the operator's choice. Routing rows
 * 151–156 are emitted through the pure deps used in health-checks.test.ts
 * only partially here (catalog + dead-selections emission).
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-models-rehoming-${Date.now()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { MODELS_ROUTING_INCIDENTS, recommendedRoutesRepair, type RoutingHealthDeps } from '../../../plugins/models/lib/health-checks'
import { MODELS_DEAD_SELECTIONS_INCIDENTS, checkDeadSelections, deadSelectionRepair, type DeadSelectionDeps } from '../../../plugins/models/lib/dead-selections'
import type { SelectionsDescription } from '../../../plugins/models/lib/dead-selections'
import { parseHealthCheckRunInput } from '../../../src/core/health-contract'
import { stampPlanItems } from '../../helpers/repair-contract'

const DEAD = 'openai/gpt-5.6-luna'
const description = (): SelectionsDescription => ({
  revision: 'rev-1',
  states: [
    { ref: 'agent:enrich:model', model: DEAD, document: 'agent:enrich', label: "H'enrich", eligibility: { status: 'ineligible', reason: 'no_credentials', detail: 'no credentials for openai' } },
    { ref: 'route:relay', model: 'openai-codex/gpt-4.9-retired', document: 'routing', label: 'relay', eligibility: { status: 'ineligible', reason: 'not_in_catalog', detail: 'gone' } },
  ],
  proposals: [
    { ref: 'agent:enrich:model', from: DEAD, to: 'openai-codex/gpt-5.6-luna', reason: 'no credentials for openai', source: 'same-id-credentialed-provider', revision: 'rev-1' },
    { ref: 'route:relay', from: 'openai-codex/gpt-4.9-retired', to: null, reason: 'gone', source: 'none', revision: 'rev-1' },
  ],
  pending: [],
  evidence: { catalog: 'ok', runtimeAvailability: 'ok', credentials: 'failed', rejections: 'ok' },
})
const deps: DeadSelectionDeps = { describe: async () => description(), openTaskTags: async () => new Set<string>(), apply: async (proposals) => ({ applied: proposals.map((p) => p.ref), failed: [], pending: [], warnings: [], revision: 'rev-2' }) }
const routingDeps = {} as RoutingHealthDeps

describe('models re-homing — catalogs', () => {
  it('models.routing (151–156): two repair families, both never-required one-clicks; clamps/on-purpose/unproven are observations', () => {
    expect(MODELS_ROUTING_INCIDENTS).toEqual([
      { id: 'unrouted-system-classes', subjectKind: 'setting', resolution: { type: 'repair', actionId: 'apply-recommended-routes' }, required: 'never' },
      { id: 'premium-on-cheap', subjectKind: 'setting', resolution: { type: 'repair', actionId: 'apply-recommended-routes' }, required: 'never' },
    ])
    const action = recommendedRoutesRepair(routingDeps, () => {})
    expect(action.effects).toEqual({ deletesUserContent: false, spendsMoney: false, widensAuthorization: true })
    expect(action.mutation).toBe('policy')
  })
  it('models.dead-selections (157–159): proposal → one-click repoint (158, W), no proposal → human decision (159), both required only while in use; evidence (157) is an observation', () => {
    expect(MODELS_DEAD_SELECTIONS_INCIDENTS).toEqual([
      { id: 'dead-selection', subjectKind: 'setting', resolution: { type: 'repair', actionId: 'apply-model-proposal' }, required: 'owner-decides' },
      { id: 'dead-selection-manual', subjectKind: 'setting', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' },
    ])
    const action = deadSelectionRepair(deps)
    expect(action.effects.widensAuthorization).toBe(true)
    expect(action.mutation).toBe('policy')
  })
})

describe('models re-homing — emitted instances (dead-selections)', () => {
  it('rows 157/158/159', async () => {
    const parsed = parseHealthCheckRunInput(await checkDeadSelections(deps))
    if (parsed.outcome !== 'observed') throw new Error(parsed.reason)
    const evidence = parsed.observations.find((o) => o.key === 'evidence:credentials')!
    expect(evidence.status).toBe('unknown')
    expect(evidence.incident).toBeUndefined()
    const proposal = parsed.observations.find((o) => o.key === 'dead-selection:agent:enrich:model')!
    expect(proposal.incident).toMatchObject({ declarationId: 'dead-selection', subject: { kind: 'setting', id: 'models.selection.agent:enrich:model' }, resolution: { type: 'repair', actionId: 'apply-model-proposal' } })
    // An agent pin (live roster) and a route with a model are in use by construction: required + action_required.
    expect(proposal.incident).toMatchObject({ required: true, disposition: 'action_required' })
    const manual = parsed.observations.find((o) => o.key === 'dead-selection:route:relay')!
    expect(manual.incident).toMatchObject({ declarationId: 'dead-selection-manual', required: true, disposition: 'action_required', resolution: { type: 'human', needs: 'decision', href: '/models?ref=route%3Arelay' } })
    const items = stampPlanItems(deadSelectionRepair(deps), await deadSelectionRepair(deps).plan({ type: 'incidents', reportId: 'r', ids: ['models:models:dead-selection:agent:enrich:model'] }))
    expect(items[0]!.mode).toBe('one-click')
  })

  it('rows 158/159 "AR while in use": a dead tag override no open task carries is advisory (required:false); with such a task it is required', async () => {
    const tagged = (): SelectionsDescription => ({
      ...description(),
      states: [{ ref: 'tag:legal', model: DEAD, document: 'routing', label: 'legal', eligibility: { status: 'ineligible', reason: 'no_credentials', detail: 'no credentials for openai' } }],
      proposals: [],
    })
    const unused = parseHealthCheckRunInput(await checkDeadSelections({ ...deps, describe: async () => tagged(), openTaskTags: async () => new Set() }))
    if (unused.outcome !== 'observed') throw new Error(unused.reason)
    expect(unused.observations.find((o) => o.key === 'dead-selection:tag:legal')).toMatchObject({ status: 'warning', incident: { declarationId: 'dead-selection-manual', required: false, disposition: 'advisory' } })
    const used = parseHealthCheckRunInput(await checkDeadSelections({ ...deps, describe: async () => tagged(), openTaskTags: async () => new Set(['legal']) }))
    if (used.outcome !== 'observed') throw new Error(used.reason)
    expect(used.observations.find((o) => o.key === 'dead-selection:tag:legal')).toMatchObject({ status: 'error', incident: { declarationId: 'dead-selection-manual', required: true, disposition: 'action_required' } })
  })
})
