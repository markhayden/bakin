/**
 * Declared incident catalogs (self-healing 1.5): a check's `incidents` are
 * finite families validated when the owner registers — the SAME call the
 * plugin context makes inside `activate()`, so a refused catalog fails the
 * owner's activation with the declaration named — and every emitted
 * instance that names a family is validated against it in the runner.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-doctor-teeth-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, audit: join(testDir, 'audit.jsonl'), tasks: join(testDir, 'tasks'), logs: join(testDir, 'logs'), db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { healthError, healthNotApplicable, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRegistrationInput, HealthIncidentDeclaration, HealthIncidentInput, HealthSubject } from '@makinbakin/sdk'
import {
  getHealthCheck,
  registerPluginHealthCheck,
  registerPluginHealthRepairAction,
  resolveDeclaredRepairAction,
  unregisterPluginHealthChecks,
} from '../../src/core/health-check-registry'
import { runDetailedPluginHealthChecks } from '../../src/core/doctor-checks'
import { buildHealthIncidents } from '../../src/core/health-report'
import { safeParseHealthCheckRunInput } from '../../src/core/health-contract'

afterEach(() => {
  unregisterPluginHealthChecks('test-a')
  unregisterPluginHealthChecks('test-b')
})

const stage = { stages: [{ id: 'apply', kind: 'installing' as const, label: 'Apply' }], pointOfNoReturn: 'apply' }

const NONE = { deletesUserContent: false, spendsMoney: false, widensAuthorization: false }
const SUBJECT: HealthSubject = { kind: 'service', id: 'svc' }

function registerAction(pluginId: string, id: string): void {
  registerPluginHealthRepairAction(pluginId, { id, name: `Action ${id}`, effects: NONE, operationPlan: () => stage, plan: async () => [], apply: async () => [] })
}

function check(incidents: HealthIncidentDeclaration[] | unknown, run: HealthCheckRegistrationInput['run'] = async () => healthNotApplicable('unused')): HealthCheckRegistrationInput {
  return {
    id: 'probe',
    name: 'Probe',
    description: 'Exercises the declared incident catalogs.',
    group: { key: 'runtime', label: 'Runtime' },
    maxAgeMs: 10 * 60_000,
    incidents: incidents as HealthIncidentDeclaration[],
    run,
  }
}

/** An emission; the subject defaults to the fixture's (every incident needs one). */
function emit(incident: Omit<HealthIncidentInput, 'subject'> & { subject?: HealthSubject }, status: 'error' | 'warning' = 'error') {
  const full = { subject: SUBJECT, ...incident } as HealthIncidentInput
  return async () => healthObserved([
    status === 'error'
      ? healthError({ key: full.key, summary: `${full.key} observed.`, incident: full as never })
      : healthWarning({ key: full.key, summary: `${full.key} observed.`, incident: full }),
  ])
}

describe('catalog validation at registration (the activation path)', () => {
  it('refuses a human family without needs, naming the declaration', () => {
    expect(() => registerPluginHealthCheck('test-a', check([{ id: 'sign-in', subjectKind: 'runtime', resolution: { type: 'human' }, required: 'always' }])))
      .toThrow(/incident "sign-in".*needs/)
    expect(getHealthCheck('test-a.probe')).toBeUndefined()
  })

  it('refuses a dangling repair action, naming the declaration and the action', () => {
    expect(() => registerPluginHealthCheck('test-a', check([{ id: 'down', subjectKind: 'service', resolution: { type: 'repair', actionId: 'restart' }, required: 'always' }])))
      .toThrow(/incident "down" with repair action "restart", which is neither registered for test-a nor a shared engine action \(core\.diagnose\)/)
    expect(getHealthCheck('test-a.probe')).toBeUndefined()
  })

  it('refuses another owner\'s action even when canonical', () => {
    registerAction('test-b', 'restart')
    expect(() => registerPluginHealthCheck('test-a', check([{ id: 'down', subjectKind: 'service', resolution: { type: 'repair', actionId: 'test-b.restart' }, required: 'always' }])))
      .toThrow(/incident "down"/)
  })

  it('refuses a duplicate family id', () => {
    registerAction('test-a', 'restart')
    expect(() => registerPluginHealthCheck('test-a', check([
      { id: 'down', subjectKind: 'service', resolution: { type: 'repair', actionId: 'restart' }, required: 'always' },
      { id: 'down', subjectKind: 'service', resolution: { type: 'human', needs: 'decision' }, required: 'never' },
    ]))).toThrow(/incident "down" twice/)
  })

  it('refuses an unknown subject kind or requirement, naming the declaration', () => {
    expect(() => registerPluginHealthCheck('test-a', check([{ id: 'odd', subjectKind: 'galaxy', resolution: { type: 'human', needs: 'decision' }, required: 'always' }])))
      .toThrow(/incident "odd".*subjectKind/)
    expect(() => registerPluginHealthCheck('test-a', check([{ id: 'odd', subjectKind: 'system', resolution: { type: 'human', needs: 'decision' }, required: 'sometimes' }])))
      .toThrow(/incident "odd".*required/)
  })

  it('accepts the shared engine action without any registration, and an owner-local action once registered', () => {
    registerAction('test-a', 'restart')
    const id = registerPluginHealthCheck('test-a', check([
      { id: 'opaque', subjectKind: 'system', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' },
      { id: 'down', subjectKind: 'service', resolution: { type: 'repair', actionId: 'restart' }, required: 'always' },
      { id: 'sign-in', subjectKind: 'runtime', resolution: { type: 'human', needs: 'credential' }, required: 'owner-decides' },
    ]))
    expect(id).toBe('test-a.probe')
    expect(getHealthCheck(id)?.incidents).toHaveLength(3)
    const owner = { kind: 'plugin' as const, id: 'test-a', label: 'test-a' }
    expect(resolveDeclaredRepairAction(owner, 'core.diagnose')).toBe('core.diagnose')
    expect(resolveDeclaredRepairAction(owner, 'restart')).toBe('test-a.restart')
    expect(resolveDeclaredRepairAction(owner, 'nope')).toBeNull()
  })

  it('a check without a catalog is refused, naming the check (every check declares its families — an empty list when it raises none)', () => {
    const def = check(undefined)
    delete (def as { incidents?: unknown }).incidents
    expect(() => registerPluginHealthCheck('test-a', def)).toThrow(/Health check "test-a.probe" declares no incident families/)
    expect(getHealthCheck('test-a.probe')).toBeUndefined()
    expect(registerPluginHealthCheck('test-a', check([]))).toBe('test-a.probe')
  })
})

describe('instance validation in the runner', () => {
  const catalog: HealthIncidentDeclaration[] = [
    { id: 'down', subjectKind: 'service', resolution: { type: 'repair', actionId: 'restart' }, required: 'always' },
    { id: 'not-ready', subjectKind: 'package', resolution: { type: 'repair', actionId: 'sync' }, required: 'owner-decides' },
    { id: 'needs-key', subjectKind: 'package', resolution: { type: 'human', needs: 'credential' }, required: 'owner-decides' },
    { id: 'opaque', subjectKind: 'system', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' },
  ]

  function registerWith(run: HealthCheckRegistrationInput['run']): void {
    registerAction('test-a', 'restart')
    registerAction('test-a', 'sync')
    registerPluginHealthCheck('test-a', check(catalog, run))
  }

  it('a matching repair instance is observed, namespaced, and keeps its declarationId through the report', async () => {
    registerWith(emit({ key: 'down', declarationId: 'down', title: 'Service is down', impact: 'Nothing runs.', disposition: 'action_required', resolution: { key: 'restart', type: 'repair', label: 'Restart', actionId: 'restart' } }))
    const [run] = await runDetailedPluginHealthChecks()
    expect(run.execution.outcome).toBe('observed')
    expect(run.observations[0].incident).toMatchObject({ declarationId: 'down', resolution: { actionId: 'test-a.restart' } })
    const incidents = buildHealthIncidents(run.observations, new Date().toISOString())
    expect(incidents[0]).toMatchObject({ declarationId: 'down', resolution: { actionId: 'test-a.restart' } })
  })

  it('an emission whose resolution differs from its declaration is invalid and becomes a verification incident', async () => {
    registerWith(emit({ key: 'down', declarationId: 'down', title: 'Service is down', impact: 'Nothing runs.', disposition: 'action_required', resolution: { key: 'open', type: 'human', needs: 'credential', label: 'Open', href: '/runtime' } }))
    const [run] = await runDetailedPluginHealthChecks()
    expect(run.execution).toMatchObject({ outcome: 'invalid', error: { code: 'INVALID_HEALTH_DECLARATION' } })
    expect(run.execution.error?.message).toMatch(/declared as repair "test-a.restart" but was emitted as human \(credential\)/)
    expect(run.observations[0]).toMatchObject({ key: 'verification', status: 'unknown' })
    // The verification row itself is the fallback lane's (row 206): the check owner's subject, core.diagnose, never required.
    expect(run.observations[0]!.incident).toMatchObject({ subject: { kind: 'plugin', id: 'test-a' }, declarationId: 'verification', required: false, resolution: { type: 'repair', actionId: 'core.diagnose' } })
  })

  it('a repair instance naming a different action than its family is invalid', async () => {
    registerWith(emit({ key: 'down', declarationId: 'down', title: 'Service is down', impact: 'Nothing runs.', disposition: 'action_required', resolution: { key: 'sync', type: 'repair', label: 'Sync', actionId: 'sync' } }))
    const [run] = await runDetailedPluginHealthChecks()
    expect(run.execution).toMatchObject({ outcome: 'invalid', error: { code: 'INVALID_HEALTH_DECLARATION' } })
  })

  it('an unknown declarationId is invalid', async () => {
    registerWith(emit({ key: 'down', declarationId: 'vanished', title: 'Service is down', impact: 'Nothing runs.', disposition: 'action_required', resolution: { key: 'restart', type: 'repair', label: 'Restart', actionId: 'restart' } }))
    const [run] = await runDetailedPluginHealthChecks()
    expect(run.execution).toMatchObject({ outcome: 'invalid', error: { code: 'INVALID_HEALTH_DECLARATION' } })
    expect(run.execution.error?.message).toMatch(/names declaration "vanished", which check test-a.probe does not declare/)
  })

  it('a record created AFTER activation emits a valid instance of its family (finite families, R3 N5)', async () => {
    registerWith(async () => healthObserved([
      healthWarning({ key: 'not-ready:web-search', summary: 'web-search is not ready.', incident: { key: 'not-ready:web-search', declarationId: 'not-ready', subject: { kind: 'package', id: 'web-search' }, required: true, title: 'web-search is not ready', impact: 'Agents lack it.', disposition: 'action_required', resolution: { key: 'sync', type: 'repair', label: 'Sync', actionId: 'sync' } } }),
      healthWarning({ key: 'not-ready:ocr', summary: 'ocr is not ready.', incident: { key: 'not-ready:ocr', declarationId: 'not-ready', subject: { kind: 'package', id: 'ocr' }, required: false, title: 'ocr is not ready', impact: 'Agents lack it.', disposition: 'action_required', resolution: { key: 'sync', type: 'repair', label: 'Sync', actionId: 'sync' } } }),
    ]))
    const [run] = await runDetailedPluginHealthChecks()
    expect(run.execution.outcome).toBe('observed')
    expect(run.observations.map((o) => o.incident?.declarationId)).toEqual(['not-ready', 'not-ready'])
    // owner-decides: the instance's own verdict rides through to the report.
    expect(run.observations.map((o) => o.incident?.required)).toEqual([true, false])
    expect(buildHealthIncidents(run.observations, new Date().toISOString()).map((i) => [i.id, i.required])).toEqual([
      ['test-a:runtime:not-ready:ocr', false],
      ['test-a:runtime:not-ready:web-search', true],
    ])
  })

  it('split repair/human variants are two families; a human family needs a human instance with the SAME needs — never a repair, never another need', async () => {
    registerWith(async () => healthObserved([
      healthWarning({ key: 'not-ready:web-search', summary: 'content missing.', incident: { key: 'not-ready:web-search', declarationId: 'not-ready', subject: { kind: 'package', id: 'web-search' }, required: true, title: 'web-search content missing', impact: 'Agents lack it.', disposition: 'action_required', resolution: { key: 'sync', type: 'repair', label: 'Sync', actionId: 'sync' } } }),
      healthWarning({ key: 'needs-key:web-search', summary: 'key missing.', incident: { key: 'needs-key:web-search', declarationId: 'needs-key', subject: { kind: 'package', id: 'web-search' }, required: true, title: 'web-search needs its key', impact: 'Agents lack it.', disposition: 'action_required', resolution: { key: 'key', type: 'human', needs: 'credential', label: 'Add the key', href: '/settings?tab=integrations', field: 'skills.web-search.BRAVE_API_KEY' } } }),
    ]))
    const [run] = await runDetailedPluginHealthChecks()
    expect(run.execution.outcome).toBe('observed')
    expect(run.observations[1]!.incident).toMatchObject({ required: true, resolution: { type: 'human', needs: 'credential', field: 'skills.web-search.BRAVE_API_KEY' } })
    unregisterPluginHealthChecks('test-a')

    registerWith(emit({ key: 'needs-key:ocr', declarationId: 'needs-key', required: true, title: 'ocr needs its key', impact: 'Agents lack it.', disposition: 'action_required', resolution: { key: 'sync', type: 'repair', label: 'Sync', actionId: 'sync' } }))
    const [again] = await runDetailedPluginHealthChecks()
    expect(again.execution).toMatchObject({ outcome: 'invalid', error: { code: 'INVALID_HEALTH_DECLARATION' } })
    expect(again.execution.error?.message).toMatch(/declared as a human need \(credential\) but was emitted as repair/)
    unregisterPluginHealthChecks('test-a')

    registerWith(emit({ key: 'needs-key:ocr', declarationId: 'needs-key', required: true, title: 'ocr needs its key', impact: 'Agents lack it.', disposition: 'action_required', resolution: { key: 'pay', type: 'human', needs: 'payment', label: 'Pay', href: '/spend' } }))
    const [other] = await runDetailedPluginHealthChecks()
    expect(other.execution).toMatchObject({ outcome: 'invalid', error: { code: 'INVALID_HEALTH_DECLARATION' } })
    expect(other.execution.error?.message).toMatch(/declared as a human need \(credential\) but was emitted as human \(payment\)/)
  })

  it('an owner-decides instance without a `required` verdict is invalid; always/never families derive it', async () => {
    registerWith(emit({ key: 'needs-key:ocr', declarationId: 'needs-key', title: 'ocr needs its key', impact: 'Agents lack it.', disposition: 'action_required', resolution: { key: 'key', type: 'human', needs: 'credential', label: 'Add the key', href: '/settings' } }))
    const [missing] = await runDetailedPluginHealthChecks()
    expect(missing.execution).toMatchObject({ outcome: 'invalid', error: { code: 'INVALID_HEALTH_DECLARATION' } })
    expect(missing.execution.error?.message).toMatch(/owner-decides family "needs-key" but carries no `required` verdict/)
    unregisterPluginHealthChecks('test-a')

    // `down` is always required; the instance's own value (false) is overridden by the family.
    registerWith(emit({ key: 'down', declarationId: 'down', required: false, title: 'Service is down', impact: 'Nothing runs.', disposition: 'action_required', resolution: { key: 'restart', type: 'repair', label: 'Restart', actionId: 'restart' } }))
    const [always] = await runDetailedPluginHealthChecks()
    expect(always.execution.outcome).toBe('observed')
    expect(always.observations[0]!.incident?.required).toBe(true)
    expect(buildHealthIncidents(always.observations, new Date().toISOString())[0]).toMatchObject({ required: true, subject: SUBJECT })
  })

  it('a warning or unknown without an incident is a plain observation: no incident id, never in the report\'s incidents', async () => {
    registerWith(async () => healthObserved([
      healthWarning({ key: 'slow', summary: 'A bit slow — listed under the check, never a card.', evidence: { p95Ms: 1200 } }),
      healthUnknown({ key: 'unseen', summary: 'Could not read the probe this sweep.' }),
      healthError({ key: 'down', summary: 'Down.', incident: { key: 'down', declarationId: 'down', subject: SUBJECT, title: 'Service is down', impact: 'Nothing runs.', disposition: 'action_required', resolution: { key: 'restart', type: 'repair', label: 'Restart', actionId: 'restart' } } }),
    ]))
    const [run] = await runDetailedPluginHealthChecks()
    expect(run.execution.outcome).toBe('observed')
    expect(run.observations.map((o) => [o.key, o.status, o.incidentId])).toEqual([
      ['slow', 'warning', undefined],
      ['unseen', 'unknown', undefined],
      ['down', 'error', 'test-a:runtime:down'],
    ])
    expect(buildHealthIncidents(run.observations, new Date().toISOString()).map((i) => i.id)).toEqual(['test-a:runtime:down'])
    // An error can never be a plain observation.
    expect(safeParseHealthCheckRunInput({ outcome: 'observed', observations: [{ key: 'broken', status: 'error', summary: 'Broken.' }] }).success).toBe(false)
  })

  it('the shared engine action is referenced verbatim by an instance of its family', async () => {
    registerWith(emit({ key: 'opaque', declarationId: 'opaque', title: 'Ledger unreadable', impact: 'Nothing is exactly-once.', disposition: 'action_required', resolution: { key: 'diagnose', type: 'repair', label: 'Investigate', actionId: 'core.diagnose' } }))
    const [run] = await runDetailedPluginHealthChecks()
    expect(run.execution.outcome).toBe('observed')
    expect(run.observations[0].incident?.resolution).toMatchObject({ actionId: 'core.diagnose' })
  })

  it('an instance without a declarationId (or a subject) is refused by the contract itself', async () => {
    registerWith(emit({ key: 'down', title: 'Service is down', impact: 'Nothing runs.', disposition: 'action_required', resolution: { key: 'restart', type: 'repair', label: 'Restart', actionId: 'restart' } } as never))
    const [run] = await runDetailedPluginHealthChecks()
    expect(run.execution).toMatchObject({ outcome: 'invalid', error: { code: 'INVALID_HEALTH_RUN_OUTPUT' } })
    expect(run.execution.error?.message).toContain('declarationId')
  })
})
