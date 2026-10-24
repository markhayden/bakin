import { afterEach, describe, expect, it } from 'bun:test'
import {
  healthError,
  healthHealthy,
  healthObserved,
  healthWarning,
} from '@makinbakin/sdk/utils'
import {
  registerPluginHealthCheck,
  registerPluginHealthRepairAction,
  unregisterPluginHealthChecks,
} from '../../src/core/health-check-registry'
import { runDetailedPluginHealthChecks, runHealthCheck } from '../../src/core/doctor-checks'
import type { HealthIncidentDeclaration } from '@makinbakin/sdk'

afterEach(() => {
  unregisterPluginHealthChecks('test-a')
  unregisterPluginHealthChecks('test-b')
})

function registration(run: () => Promise<any>, incidents: HealthIncidentDeclaration[] = []) {
  return {
    id: 'probe',
    name: 'Test probe',
    description: 'Exercises the validating Health runner.',
    group: { key: 'runtime', label: 'Runtime' },
    maxAgeMs: 10 * 60_000,
    incidents,
    run,
  }
}

const stage = { stages: [{ id: 'apply', kind: 'installing' as const, label: 'Apply' }], pointOfNoReturn: 'apply' }
const NONE = { deletesUserContent: false, spendsMoney: false, widensAuthorization: false }

function fixedClock() {
  const values = [
    new Date('2026-07-13T12:00:00.000Z'),
    new Date('2026-07-13T12:00:01.000Z'),
  ]
  return () => values.shift() ?? values[values.length - 1]!
}

describe('validating Health runner', () => {
  it('stamps owner/check/observation/incident identity and freshness', async () => {
    const id = registerPluginHealthCheck('test-a', registration(async () => healthObserved([
      healthWarning({
        key: 'slow',
        summary: 'The runtime is responding slowly.',
        sourceObservedAt: '2026-07-13T11:59:00.000Z',
        incident: {
          key: 'latency',
          title: 'Runtime latency is elevated',
          impact: 'Agent turns may take longer.',
          disposition: 'watch',
          subject: { kind: 'runtime', id: 'pi' },
          declarationId: 'latency',
          resolution: { key: 'review', type: 'human', needs: 'decision', label: 'Review runtime', href: '/health?tab=system' },
        },
      }),
    ]), [{ id: 'latency', subjectKind: 'runtime', resolution: { type: 'human', needs: 'decision' }, required: 'never' }]), 'Test A')
    const def = (await import('../../src/core/health-check-registry')).getHealthCheck(id)!

    const run = await runHealthCheck(def, { now: fixedClock(), executionId: () => 'execution-test' })

    expect(run.execution).toMatchObject({
      id: 'execution-test',
      checkId: 'test-a.probe',
      outcome: 'observed',
      startedAt: '2026-07-13T12:00:00.000Z',
      completedAt: '2026-07-13T12:00:01.000Z',
    })
    expect(run.observations[0]).toMatchObject({
      id: 'test-a.probe:slow',
      checkId: 'test-a.probe',
      owner: { kind: 'plugin', id: 'test-a', label: 'Test A' },
      incidentId: 'test-a:runtime:latency',
      observedAt: '2026-07-13T11:59:00.000Z',
      staleAt: '2026-07-13T12:11:00.000Z',
      snapshot: 'current',
    })
  })

  it('isolates throws and emits a core-owned Unknown verification incident', async () => {
    registerPluginHealthCheck('test-a', registration(async () => { throw new Error('probe exploded') }))
    registerPluginHealthCheck('test-b', registration(async () => healthObserved([
      healthHealthy({ key: 'ready', summary: 'Ready.' }),
    ])))

    const runs = await runDetailedPluginHealthChecks({ executionId: () => 'execution-test' })
    const failed = runs.find((run) => run.def.id === 'test-a.probe')!
    const healthy = runs.find((run) => run.def.id === 'test-b.probe')!

    expect(failed.execution).toMatchObject({ outcome: 'failed', error: { code: 'HEALTH_CHECK_FAILED' } })
    expect(failed.observations[0]).toMatchObject({
      status: 'unknown',
      owner: { kind: 'core', id: 'core', label: 'Bakin' },
      incidentId: 'core:verification:test-a.probe',
    })
    expect(failed.observations[0].detail).toContain('probe exploded')
    expect(healthy.execution.outcome).toBe('observed')
    expect(healthy.observations[0].status).toBe('healthy')
  })

  it('bounds checks that never settle with a trustworthy timeout result', async () => {
    registerPluginHealthCheck('test-a', {
      ...registration(async () => new Promise(() => {})),
      timeoutMs: 5,
    })
    const [run] = await runDetailedPluginHealthChecks({
      executionId: () => 'execution-timeout',
      timeoutMs: 50,
    })

    expect(run.execution).toMatchObject({
      id: 'execution-timeout',
      outcome: 'failed',
      error: {
        code: 'HEALTH_CHECK_TIMEOUT',
        message: 'Health check "Test probe" timed out after 5 ms.',
      },
    })
    expect(run.observations[0]).toMatchObject({
      status: 'unknown',
      incidentId: 'core:verification:test-a.probe',
      detail: 'Health check "Test probe" timed out after 5 ms.',
    })
  })

  it('turns malformed output into invalid without publishing its payload', async () => {
    registerPluginHealthCheck('test-a', registration(async () => ({ outcome: 'observed', observations: [] })))
    const [run] = await runDetailedPluginHealthChecks()
    expect(run.execution).toMatchObject({
      outcome: 'invalid',
      error: { code: 'INVALID_HEALTH_RUN_OUTPUT' },
    })
    expect(run.observations).toHaveLength(1)
    expect(run.observations[0].status).toBe('unknown')
  })

  const unavailableFamily: HealthIncidentDeclaration[] = [{ id: 'unavailable', subjectKind: 'runtime', resolution: { type: 'repair', actionId: 'restart' }, required: 'always' }]

  it('namespaces valid owner-local repair references', async () => {
    registerPluginHealthRepairAction('test-a', { id: 'restart', name: 'Restart runtime', effects: NONE, operationPlan: () => stage, plan: async () => [], apply: async () => [] })
    registerPluginHealthCheck('test-a', registration(async () => healthObserved([
      healthError({
        key: 'down',
        summary: 'Runtime is unavailable.',
        incident: {
          key: 'unavailable',
          title: 'Runtime is unavailable',
          impact: 'Agents cannot run.',
          disposition: 'action_required',
          subject: { kind: 'runtime', id: 'pi' },
          declarationId: 'unavailable',
          resolution: { key: 'restart', type: 'repair', label: 'Review restart', actionId: 'restart' },
        },
      }),
    ]), unavailableFamily))

    const [run] = await runDetailedPluginHealthChecks()
    expect(run.execution.outcome).toBe('observed')
    expect(run.observations[0].incident?.resolution).toMatchObject({ actionId: 'test-a.restart' })
  })

  it('rejects cross-owner or missing repair references as invalid', async () => {
    // The catalog names test-a's own `restart`; the EMISSION points at test-b's — refused at the runner.
    registerPluginHealthRepairAction('test-a', { id: 'restart', name: 'Restart', effects: NONE, operationPlan: () => stage, plan: async () => [], apply: async () => [] })
    registerPluginHealthRepairAction('test-b', { id: 'restart', name: 'Restart', effects: NONE, operationPlan: () => stage, plan: async () => [], apply: async () => [] })
    registerPluginHealthCheck('test-a', registration(async () => healthObserved([
      healthError({
        key: 'down',
        summary: 'Runtime is unavailable.',
        incident: {
          key: 'unavailable',
          title: 'Runtime is unavailable',
          impact: 'Agents cannot run.',
          disposition: 'action_required',
          subject: { kind: 'runtime', id: 'pi' },
          declarationId: 'unavailable',
          resolution: { key: 'restart', type: 'repair', label: 'Review restart', actionId: 'test-b.restart' },
        },
      }),
    ]), unavailableFamily))

    const [run] = await runDetailedPluginHealthChecks()
    expect(run.execution).toMatchObject({ outcome: 'invalid', error: { code: 'INVALID_HEALTH_REFERENCE' } })
  })
})
