import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { healthHealthy, healthObserved } from '@makinbakin/sdk/utils'

const appendAudit = mock()
let onboarded = true
let settings = {
  doctor: {
    intervalMs: 60_000,
    checkTimeoutMs: 30_000,
    requireOnboard: false,
    escalation: 'off' as const,
    escalationCooldownMs: 60_000,
  },
}

mock.module('../../src/core/audit', () => ({ appendAudit }))
mock.module('../../src/core/onboarding/state', () => ({ isOnboarded: () => onboarded }))
mock.module('../../src/core/settings', () => ({ getSettings: () => settings }))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
}))

import {
  getLastReport,
  resetDoctorFlightsForTests,
  runDiagnostics,
  runTargetedDiagnostics,
} from '../../src/core/doctor'
import { resetHealthReportCache } from '../../src/core/doctor-report-cache'
import {
  registerPluginHealthCheck,
  unregisterHealthCheck,
  unregisterPluginHealthChecks,
} from '../../src/core/health-check-registry'

beforeEach(() => {
  resetHealthReportCache()
  resetDoctorFlightsForTests()
  appendAudit.mockClear()
  onboarded = true
  settings = {
    doctor: {
      intervalMs: 60_000,
      checkTimeoutMs: 30_000,
      requireOnboard: false,
      escalation: 'off',
      escalationCooldownMs: 60_000,
    },
  }
})

afterEach(() => {
  unregisterPluginHealthChecks('doctor-test')
  unregisterHealthCheck('core.onboarded')
})

function register(run: () => Promise<any>) {
  return registerPluginHealthCheck('doctor-test', {
    id: 'probe',
    name: 'Doctor probe',
    description: 'Exercises canonical doctor orchestration.',
    group: { key: 'runtime', label: 'Runtime' },
    run,
  }, 'Doctor Test')
}

describe('canonical doctor orchestration', () => {
  it('returns a canonical report and records the full sweep', async () => {
    register(async () => healthObserved([healthHealthy({ key: 'ready', summary: 'Ready.' })]))
    const report = await runDiagnostics('/tmp/content', '/tmp/project')
    expect(report).toMatchObject({
      id: expect.stringMatching(/^health-report-/),
      overallStatus: 'healthy',
      summary: { checks: { registered: 2, completed: 2 } },
      lastFullSweep: { id: expect.stringMatching(/^sweep-/) },
    })
    expect(appendAudit).toHaveBeenCalledWith('/tmp/content', 'doctor.run', 'system', expect.objectContaining({
      reportId: report.id,
      overallStatus: 'healthy',
    }))
  })

  it('globally joins overlapping full sweeps', async () => {
    let resolve!: () => void
    const gate = new Promise<void>((done) => { resolve = done })
    const run = mock(async () => {
      await gate
      return healthObserved([healthHealthy({ key: 'ready', summary: 'Ready.' })])
    })
    register(run)
    const first = runDiagnostics('/tmp/content', '/tmp/project')
    const second = runDiagnostics('/tmp/content', '/tmp/project')
    resolve()
    const [a, b] = await Promise.all([first, second])
    expect(a.id).toBe(b.id)
    expect(run).toHaveBeenCalledTimes(1)
    expect(appendAudit).toHaveBeenCalledTimes(1)
  })

  it('joins a targeted check execution with an overlapping full sweep', async () => {
    let resolve!: () => void
    const gate = new Promise<void>((done) => { resolve = done })
    const run = mock(async () => {
      await gate
      return healthObserved([healthHealthy({ key: 'ready', summary: 'Ready.' })])
    })
    const id = register(run)
    const full = runDiagnostics('/tmp/content', '/tmp/project')
    const targeted = runTargetedDiagnostics([id])
    resolve()
    await Promise.all([full, targeted])
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('releases timed-out check and sweep flights so a later run can recover', async () => {
    settings.doctor.checkTimeoutMs = 5
    let recovered = false
    let timedOutSignal: AbortSignal | undefined
    const run = mock(async (context?: { signal: AbortSignal }) => {
      if (!recovered) {
        timedOutSignal = context?.signal
        await new Promise<never>((_, reject) => {
          context?.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true })
        })
      }
      return healthObserved([healthHealthy({ key: 'ready', summary: 'Recovered.' })])
    })
    const id = register(run)

    const [firstFull, firstTargeted] = await Promise.all([
      runDiagnostics('/tmp/content', '/tmp/project'),
      runTargetedDiagnostics([id]),
    ])

    expect(run).toHaveBeenCalledTimes(1)
    expect(timedOutSignal?.aborted).toBe(true)
    expect(firstFull.lastFullSweep).not.toBeNull()
    expect(firstFull.checks.find((check) => check.checkId === id)?.latestExecution).toMatchObject({
      outcome: 'failed',
      error: { code: 'HEALTH_CHECK_TIMEOUT' },
    })
    expect(firstTargeted.checks.find((check) => check.checkId === id)?.latestExecution.error?.code)
      .toBe('HEALTH_CHECK_TIMEOUT')

    recovered = true
    const second = await runDiagnostics('/tmp/content', '/tmp/project')

    expect(run).toHaveBeenCalledTimes(2)
    expect(second.checks.find((check) => check.checkId === id)?.latestExecution.outcome).toBe('observed')
    expect(second.observations.find((observation) => observation.checkId === id)?.summary).toBe('Recovered.')
  })

  it('does not overlap a retry when a timed-out check ignores cancellation', async () => {
    settings.doctor.checkTimeoutMs = 5
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const run = mock(async () => {
      await gate
      return healthObserved([healthHealthy({ key: 'ready', summary: 'Eventually settled.' })])
    })
    const id = register(run)

    const first = await runTargetedDiagnostics([id])
    const second = await runDiagnostics('/tmp/content', '/tmp/project')

    expect(first.checks.find((check) => check.checkId === id)?.latestExecution.error?.code)
      .toBe('HEALTH_CHECK_TIMEOUT')
    expect(second.checks.find((check) => check.checkId === id)?.latestExecution.error?.code)
      .toBe('HEALTH_CHECK_TIMEOUT')
    expect(second.lastFullSweep).not.toBeNull()
    expect(run).toHaveBeenCalledTimes(1)

    release()
    await gate
    await new Promise((resolve) => setTimeout(resolve, 0))
    const third = await runTargetedDiagnostics([id])

    expect(run).toHaveBeenCalledTimes(2)
    expect(third.observations.find((observation) => observation.checkId === id)?.summary)
      .toBe('Eventually settled.')
  })

  it('does not record a full sweep when a check is replaced under the same id', async () => {
    let resolve!: () => void
    const gate = new Promise<void>((done) => { resolve = done })
    register(async () => {
      await gate
      return healthObserved([healthHealthy({ key: 'ready', summary: 'Old definition.' })])
    })

    const full = runDiagnostics('/tmp/content', '/tmp/project')
    unregisterPluginHealthChecks('doctor-test')
    register(async () => healthObserved([healthHealthy({ key: 'ready', summary: 'New definition.' })]))
    resolve()
    const report = await full

    expect(report.lastFullSweep).toBeNull()
    expect(report.checks.find((check) => check.checkId === 'doctor-test.probe')?.latestExecution.error?.code)
      .toBe('MISSING_HEALTH_EXECUTION')
  })

  it('executes a replacement definition instead of joining the old same-id flight', async () => {
    let resolveOld!: () => void
    const oldGate = new Promise<void>((done) => { resolveOld = done })
    const id = register(async () => {
      await oldGate
      return healthObserved([healthHealthy({ key: 'ready', summary: 'Old definition.' })])
    })
    const oldFlight = runTargetedDiagnostics([id])

    unregisterPluginHealthChecks('doctor-test')
    const replacement = mock(async () =>
      healthObserved([healthHealthy({ key: 'ready', summary: 'New definition.' })]),
    )
    register(replacement)
    const full = runDiagnostics('/tmp/content', '/tmp/project')

    resolveOld()
    const [, report] = await Promise.all([oldFlight, full])

    expect(replacement).toHaveBeenCalledTimes(1)
    expect(report.lastFullSweep).not.toBeNull()
    expect(report.observations.find((row) => row.checkId === id)?.summary).toBe('New definition.')
  })

  it('keeps targeted refreshes from rewriting lastFullSweep', async () => {
    const id = register(async () => healthObserved([healthHealthy({ key: 'ready', summary: 'Ready.' })]))
    const full = await runDiagnostics('/tmp/content', '/tmp/project')
    const sweepId = full.lastFullSweep?.id
    const targeted = await runTargetedDiagnostics([id])
    expect(targeted.lastFullSweep?.id).toBe(sweepId)
    expect(targeted.revision).toBeGreaterThan(full.revision)
  })

  it('represents the onboarding gate as a core-owned actionable incident', async () => {
    settings.doctor.requireOnboard = true
    onboarded = false
    const report = await runDiagnostics('/tmp/content', '/tmp/project')
    expect(report.overallStatus).toBe('needs_attention')
    expect(report.incidents).toEqual([expect.objectContaining({
      id: 'core:system:onboarding-required',
      disposition: 'action_required',
    })])
    expect(report.observations[0].owner).toEqual({ kind: 'core', id: 'core', label: 'Bakin' })
  })

  it('serves the cached projection without executing checks', async () => {
    const run = mock(async () => healthObserved([healthHealthy({ key: 'ready', summary: 'Ready.' })]))
    register(run)
    await runDiagnostics('/tmp/content', '/tmp/project')
    const before = run.mock.calls.length
    const cached = getLastReport()
    expect(run).toHaveBeenCalledTimes(before)
    expect(cached.lastFullSweep).not.toBeNull()
  })
})
