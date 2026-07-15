import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { healthHealthy, healthNotApplicable, healthObserved, healthWarning } from '@makinbakin/sdk/utils'
import { runHealthCheck } from '../../src/core/doctor-checks'
import {
  applyHealthCheckRun,
  getHealthReport,
  onHealthReportChanged,
  resetHealthReportCache,
  setLastFullHealthSweep,
} from '../../src/core/doctor-report-cache'
import {
  getHealthCheck,
  registerPluginHealthCheck,
  unregisterPluginHealthChecks,
} from '../../src/core/health-check-registry'

beforeEach(resetHealthReportCache)
afterEach(() => unregisterPluginHealthChecks('cache-test'))

function register(run: () => Promise<any>, localId = 'probe', name = 'Cache probe') {
  const id = registerPluginHealthCheck('cache-test', {
    id: localId,
    name,
    description: 'Exercises canonical Health cache replacement.',
    group: { key: 'runtime', label: 'Runtime' },
    maxAgeMs: 60_000,
    run,
  }, 'Cache Test')
  return getHealthCheck(id)!
}

async function apply(def: ReturnType<typeof register>, time: string, execution = 'execution-1') {
  const values = [new Date(time), new Date(time)]
  applyHealthCheckRun(await runHealthCheck(def, {
    now: () => values.shift()!,
    executionId: () => execution,
  }))
}

describe('per-check Health cache', () => {
  it('replaces a successful snapshot as a whole and resolves absent findings', async () => {
    let warning = true
    const def = register(async () => healthObserved(warning ? [
      healthWarning({
        key: 'latency', summary: 'Slow.',
        incident: {
          key: 'latency', title: 'Runtime is slow', impact: 'Turns take longer.', disposition: 'watch',
          resolution: { key: 'rerun', type: 'rerun', label: 'Check again' },
        },
      }),
    ] : [healthHealthy({ key: 'ready', summary: 'Ready.' })]))

    await apply(def, '2026-07-13T12:00:00.000Z')
    expect(getHealthReport('2026-07-13T12:00:30.000Z').incidents).toHaveLength(1)
    warning = false
    await apply(def, '2026-07-13T12:00:40.000Z', 'execution-2')

    const report = getHealthReport('2026-07-13T12:01:00.000Z')
    expect(report.incidents).toEqual([])
    expect(report.observations.map((row) => row.key)).toEqual(['ready'])
  })

  it('retains last-known evidence and adds Unknown after a failed rerun', async () => {
    let shouldThrow = false
    const def = register(async () => {
      if (shouldThrow) throw new Error('temporarily unavailable')
      return healthObserved([healthHealthy({ key: 'ready', summary: 'Ready.' })])
    })
    await apply(def, '2026-07-13T12:00:00.000Z')
    shouldThrow = true
    await apply(def, '2026-07-13T12:00:30.000Z', 'execution-2')

    const report = getHealthReport('2026-07-13T12:00:40.000Z')
    expect(report.checks[0].latestExecution.outcome).toBe('failed')
    expect(report.observations.find((row) => row.key === 'ready')?.snapshot).toBe('last_known')
    expect(report.incidents).toEqual([expect.objectContaining({ status: 'unknown' })])
    expect(report.overallStatus).toBe('unknown_stale')
  })

  it('clears old evidence after an explicit not-applicable result', async () => {
    let applicable = true
    const def = register(async () => applicable
      ? healthObserved([healthHealthy({ key: 'ready', summary: 'Ready.' })])
      : healthNotApplicable('This runtime does not expose the probe.'))
    await apply(def, '2026-07-13T12:00:00.000Z')
    applicable = false
    await apply(def, '2026-07-13T12:00:30.000Z', 'execution-2')

    const report = getHealthReport('2026-07-13T12:00:40.000Z')
    expect(report.observations).toEqual([])
    expect(report.summary.checks.notApplicable).toBe(1)
    expect(report.overallStatus).toBe('healthy')
  })

  it('expires a not-applicable result using the check freshness window', async () => {
    const def = register(async () => healthNotApplicable('This runtime does not expose the probe.'))
    await apply(def, '2026-07-13T12:00:00.000Z')

    const report = getHealthReport('2026-07-13T12:02:01.000Z')
    expect(report.incidents).toEqual([expect.objectContaining({
      id: 'core:verification:stale:cache-test.probe',
      status: 'unknown',
    })])
    expect(report.overallStatus).toBe('unknown_stale')
  })

  it('makes missing and stale required evidence explicitly Unknown', async () => {
    const def = register(async () => healthObserved([healthHealthy({ key: 'ready', summary: 'Ready.' })]))
    const missing = getHealthReport('2026-07-13T12:00:00.000Z')
    expect(missing.incidents[0]).toMatchObject({ id: 'core:verification:missing:cache-test.probe' })

    await apply(def, '2026-07-13T12:00:00.000Z')
    const stale = getHealthReport('2026-07-13T12:02:01.000Z')
    expect(stale.observations.find((row) => row.key === 'ready')?.snapshot).toBe('last_known')
    expect(stale.incidents.find((row) => row.id.includes(':stale:'))).toBeDefined()
    expect(stale.overallStatus).toBe('unknown_stale')
  })

  it('drops cache state immediately when an owner unregisters', async () => {
    const def = register(async () => healthObserved([healthHealthy({ key: 'ready', summary: 'Ready.' })]))
    await apply(def, '2026-07-13T12:00:00.000Z')
    unregisterPluginHealthChecks('cache-test')
    const report = getHealthReport('2026-07-13T12:00:30.000Z')
    expect(report.checks).toEqual([])
    expect(report.observations).toEqual([])
  })

  it('tracks revision and last full sweep independently from fetch time', async () => {
    const def = register(async () => healthObserved([healthHealthy({ key: 'ready', summary: 'Ready.' })]))
    const before = getHealthReport('2026-07-13T12:00:00.000Z').revision
    await apply(def, '2026-07-13T12:00:00.000Z')
    setLastFullHealthSweep({
      id: 'sweep-1',
      startedAt: '2026-07-13T12:00:00.000Z',
      completedAt: '2026-07-13T12:00:01.000Z',
    })
    const report = getHealthReport('2026-07-13T12:00:30.000Z')
    expect(report.revision).toBeGreaterThan(before)
    expect(report.lastFullSweep?.id).toBe('sweep-1')
    expect(getHealthReport('2026-07-13T12:00:45.000Z').revision).toBe(report.revision)
  })

  it('replaces a conflicting shared incident with verification evidence for every involved check', async () => {
    const first = register(async () => healthObserved([
      healthWarning({
        key: 'first', summary: 'First producer saw the shared condition.',
        incident: {
          key: 'shared', title: 'First shared title', impact: 'Shared impact.', disposition: 'watch',
          resolution: { key: 'rerun', type: 'rerun', label: 'Check again' },
        },
      }),
    ]), 'probe-a', 'First cache probe')
    const second = register(async () => healthObserved([
      healthWarning({
        key: 'second', summary: 'Second producer saw the shared condition.',
        incident: {
          key: 'shared', title: 'Conflicting shared title', impact: 'Shared impact.', disposition: 'watch',
          resolution: { key: 'rerun', type: 'rerun', label: 'Check again' },
        },
      }),
    ]), 'probe-b', 'Second cache probe')

    await apply(first, '2026-07-13T12:00:00.000Z', 'execution-a')
    await apply(second, '2026-07-13T12:00:00.000Z', 'execution-b')

    const report = getHealthReport('2026-07-13T12:00:30.000Z')
    expect(report.observations.map((observation) => observation.id)).toEqual([
      'cache-test.probe-a:verification.conflict',
      'cache-test.probe-b:verification.conflict',
    ])
    expect(report.incidents.map((incident) => incident.id)).toEqual([
      'core:verification:conflict:cache-test.probe-a',
      'core:verification:conflict:cache-test.probe-b',
    ])
    expect(report.overallStatus).toBe('unknown_stale')
  })

  it('publishes one conflict replacement when a check participates in two independent conflicts', async () => {
    const shared = register(async () => healthObserved([
      healthWarning({
        key: 'shared-a', summary: 'Shared producer saw the first condition.',
        incident: {
          key: 'shared-a', title: 'First shared title', impact: 'Shared impact.', disposition: 'watch',
          resolution: { key: 'rerun', type: 'rerun', label: 'Check again' },
        },
      }),
      healthWarning({
        key: 'shared-b', summary: 'Shared producer saw the second condition.',
        incident: {
          key: 'shared-b', title: 'Second shared title', impact: 'Shared impact.', disposition: 'watch',
          resolution: { key: 'rerun', type: 'rerun', label: 'Check again' },
        },
      }),
    ]), 'shared-probe', 'Shared cache probe')
    const firstConflict = register(async () => healthObserved([
      healthWarning({
        key: 'first-conflict', summary: 'First conflict producer disagreed.',
        incident: {
          key: 'shared-a', title: 'Conflicting first title', impact: 'Shared impact.', disposition: 'watch',
          resolution: { key: 'rerun', type: 'rerun', label: 'Check again' },
        },
      }),
    ]), 'probe-a', 'First conflict probe')
    const secondConflict = register(async () => healthObserved([
      healthWarning({
        key: 'second-conflict', summary: 'Second conflict producer disagreed.',
        incident: {
          key: 'shared-b', title: 'Conflicting second title', impact: 'Shared impact.', disposition: 'watch',
          resolution: { key: 'rerun', type: 'rerun', label: 'Check again' },
        },
      }),
    ]), 'probe-b', 'Second conflict probe')

    await apply(shared, '2026-07-13T12:00:00.000Z', 'execution-shared')
    await apply(firstConflict, '2026-07-13T12:00:00.000Z', 'execution-a')
    await apply(secondConflict, '2026-07-13T12:00:00.000Z', 'execution-b')

    const report = getHealthReport('2026-07-13T12:00:30.000Z')
    const observationIds = report.observations.map((observation) => observation.id)
    const incidentIds = report.incidents.map((incident) => incident.id)
    expect(observationIds).toHaveLength(3)
    expect(new Set(observationIds).size).toBe(observationIds.length)
    expect(observationIds.filter((id) => id === 'cache-test.shared-probe:verification.conflict')).toHaveLength(1)
    const sharedReplacement = report.observations.find((observation) =>
      observation.id === 'cache-test.shared-probe:verification.conflict')
    expect(sharedReplacement?.detail).toContain('cache-test:runtime:shared-a')
    expect(sharedReplacement?.detail).toContain('cache-test:runtime:shared-b')
    expect(incidentIds).toHaveLength(3)
    expect(new Set(incidentIds).size).toBe(incidentIds.length)
    expect(incidentIds.filter((id) => id === 'core:verification:conflict:cache-test.shared-probe')).toHaveLength(1)
  })

  it('advances the report revision once when cached evidence crosses its freshness boundary', async () => {
    const def = register(async () => healthObserved([healthHealthy({ key: 'ready', summary: 'Ready.' })]))
    await apply(def, '2026-07-13T12:00:00.000Z')

    const fresh = getHealthReport('2026-07-13T12:01:59.000Z')
    const independentFreshProjection = getHealthReport('2026-07-13T12:01:59.500Z')
    expect(independentFreshProjection.id).toBe(fresh.id)
    expect(independentFreshProjection.generatedAt).toBe(fresh.generatedAt)
    const changedReportIds: string[] = []
    const unsubscribe = onHealthReportChanged((report) => changedReportIds.push(report.id))
    const stale = getHealthReport('2026-07-13T12:02:01.000Z')
    const independentStaleProjection = getHealthReport('2026-07-13T12:02:02.000Z')
    unsubscribe()

    expect(stale.revision).toBe(fresh.revision + 1)
    expect(stale.id).not.toBe(fresh.id)
    expect(stale.observations.find((row) => row.key === 'ready')?.snapshot).toBe('last_known')
    expect(stale.incidents.some((incident) => incident.id.includes(':stale:'))).toBe(true)
    expect(independentStaleProjection.revision).toBe(stale.revision)
    expect(independentStaleProjection.id).toBe(stale.id)
    expect(independentStaleProjection.generatedAt).toBe(stale.generatedAt)
    expect(independentStaleProjection.observations.map((row) => [row.id, row.snapshot])).toEqual(
      stale.observations.map((row) => [row.id, row.snapshot]),
    )
    expect(independentStaleProjection.incidents.map((incident) => [incident.id, incident.stale])).toEqual(
      stale.incidents.map((incident) => [incident.id, incident.stale]),
    )
    expect(changedReportIds).toEqual([stale.id])
  })
})
