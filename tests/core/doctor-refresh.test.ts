import { describe, expect, it } from 'bun:test'
import { createDoctorRefreshCoordinator, healthChecksAffectedByEvent } from '../../src/core/doctor-refresh'

describe('background diagnostic freshness', () => {
  it('refreshes an expired check without a Health page and leaves fresh checks alone', async () => {
    let completedAt = 0
    let runs = 0
    let projections = 0
    const runner = createDoctorRefreshCoordinator({
      checks: () => [{ id: 'runtime', maxAgeMs: 60_000, completedAt, failed: false }],
      run: async () => { runs++; completedAt = 60_000 },
      project: () => { projections++ },
      onError: () => {},
    })
    await runner.tick(59_000)
    expect(runs).toBe(0)
    await runner.tick(60_000)
    expect(runs).toBe(1)
    await runner.tick(61_000)
    expect(runs).toBe(1)
    expect(projections).toBe(3)
    runner.stop()
  })

  it('queues a mutation arriving during a check instead of losing it to single-flight', async () => {
    let resolve!: () => void
    let runs = 0
    const runner = createDoctorRefreshCoordinator({
      checks: () => [{ id: 'task', maxAgeMs: 60_000, completedAt: 0, failed: false }],
      run: async () => { runs++; if (runs === 1) await new Promise<void>((done) => { resolve = done }) },
      project: () => {}, onError: () => {},
    })
    runner.invalidate(['task'])
    const first = runner.tick(1)
    runner.invalidate(['task'])
    await runner.tick(2)
    expect(runs).toBe(1)
    resolve()
    await first
    await runner.tick(3)
    expect(runs).toBe(2)
    runner.stop()
  })

  it('backs off failed checks and stops all subsequent work on shutdown', async () => {
    let runs = 0
    const runner = createDoctorRefreshCoordinator({
      checks: () => [{ id: 'missing', maxAgeMs: 60_000, completedAt: null, failed: true }],
      run: async () => { runs++; throw new Error('offline') },
      project: () => {}, onError: () => {},
    })
    await runner.tick(0)
    await runner.tick(1000)
    expect(runs).toBe(1)
    await runner.tick(30_000)
    expect(runs).toBe(2)
    runner.stop()
    runner.invalidate(['missing'])
    await runner.tick(90_000)
    expect(runs).toBe(2)
  })
})

it('invalidates owning diagnostics for durable events and ignores streaming/report output', () => {
  const checks = [
    { id: 'tasks.integrity', localId: 'integrity', owner: { id: 'tasks', kind: 'plugin' } },
    { id: 'workflows.integrity', localId: 'integrity', owner: { id: 'workflows', kind: 'plugin' } },
    { id: 'health.restart-recovery', localId: 'restart-recovery', owner: { id: 'health', kind: 'plugin' } },
    { id: 'health.execution-safety', localId: 'execution-safety', owner: { id: 'health', kind: 'plugin' } },
    { id: 'health.search', localId: 'search', owner: { id: 'health', kind: 'plugin' } },
  ]
  const taskChecks = ['tasks.integrity', 'workflows.integrity', 'health.restart-recovery', 'health.execution-safety']
  // The task store emits a top-level type and a separate mutation verb.
  expect(healthChecksAffectedByEvent({ type: 'taskboard', event: 'change' }, checks)).toEqual(taskChecks)
  expect(healthChecksAffectedByEvent({ type: 'plugin-event', event: 'workflow.gate_approved' }, checks)).toEqual(taskChecks)
  expect(healthChecksAffectedByEvent({ type: 'search.rebuild.complete' }, checks)).toEqual(['health.search'])
  expect(healthChecksAffectedByEvent({ event: 'health.report.changed' }, checks)).toEqual([])
  expect(healthChecksAffectedByEvent({ type: 'search.rebuild.progress' }, checks)).toEqual([])
})
