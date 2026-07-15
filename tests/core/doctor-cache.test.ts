import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { healthHealthy, healthNotApplicable, healthObserved, healthWarning } from '@makinbakin/sdk/utils'
import { runHealthCheck } from '../../src/core/doctor-checks'
import {
  applyHealthCheckRun,
  getHealthReport,
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
})
