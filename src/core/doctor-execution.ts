/** Canonical Health execution: cache, single-flight diagnostics, and audit. */
import { healthError, healthHealthy, healthNotApplicable, healthObserved } from '@makinbakin/sdk/utils'
import type { HealthCheckDef, HealthReport } from '../../packages/core/src/plugin-types'
import { appendAudit } from './audit'
import {
  DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
  runHealthCheck,
  type DetailedHealthCheckRun,
} from './doctor-checks'
import {
  applyHealthCheckRun,
  getHealthReport,
  onHealthReportChanged,
  setLastFullHealthSweep,
} from './doctor-report-cache'
import {
  getHealthCheck,
  listHealthChecks,
  registerCoreHealthCheck,
} from './health-check-registry'
import { isOnboarded } from './onboarding/state'
import { getSettings } from './settings'

const checkFlights = new Map<string, CheckFlight>()
let fullSweepFlight: Promise<HealthReport> | null = null

interface CheckFlight {
  def: HealthCheckDef
  promise: Promise<DetailedHealthCheckRun>
  lifecycleSettled: Promise<void>
}

onHealthReportChanged((report) => {
  const broadcast = (globalThis as { __bakinBroadcast?: (data: Record<string, unknown>) => void }).__bakinBroadcast
  broadcast?.({
    type: 'plugin-event',
    event: 'health.report.changed',
    reportId: report.id,
    revision: report.revision,
    timestamp: report.generatedAt,
  })
})

function doctorIntervalMs(): number {
  return getSettings().doctor.intervalMs
}

function doctorCheckTimeoutMs(): number {
  return getSettings().doctor.checkTimeoutMs ?? DEFAULT_HEALTH_CHECK_TIMEOUT_MS
}

function ensureOnboardingCheck(): void {
  if (getHealthCheck('core.onboarded')) return
  registerCoreHealthCheck({
    id: 'onboarded',
    name: 'First-run onboarding',
    description: 'Verifies that required first-run setup has completed on this machine.',
    group: { key: 'system', label: 'System' },
    maxAgeMs: doctorIntervalMs(),
    run: async () => {
      const settings = getSettings()
      if (!settings.doctor.requireOnboard) {
        return healthNotApplicable('This installation does not require the onboarding gate.')
      }
      if (isOnboarded()) {
        return healthObserved([healthHealthy({ key: 'complete', summary: 'Bakin onboarding is complete.' })])
      }
      return healthObserved([healthError({
        key: 'required',
        summary: 'Bakin has not completed first-run setup.',
        incident: {
          key: 'onboarding-required',
          title: 'First-run setup is incomplete',
          impact: 'Runtime and plugin checks may fail until Bakin is configured.',
          disposition: 'action_required',
          resources: [{ kind: 'system', id: 'onboarding', label: 'Bakin onboarding' }],
          resolution: {
            key: 'run-onboarding',
            type: 'instructions',
            label: 'Complete setup',
            steps: ['Run the onboarding command and follow its prompts.'],
            command: 'bakin onboard',
          },
        },
      })])
    },
  })
}

function executeSingleFlight(def: HealthCheckDef): Promise<DetailedHealthCheckRun> {
  const existing = checkFlights.get(def.id)
  if (existing?.def === def) return existing.promise
  let workSettled: Promise<void> | undefined
  const promise = runHealthCheck(def, {
    defaultMaxAgeMs: doctorIntervalMs(),
    timeoutMs: doctorCheckTimeoutMs(),
    onWorkSettled: (settled) => { workSettled = settled },
  })
    .then((run) => {
      // A hot-reloaded/unregistered definition must not repopulate its old cache.
      if (getHealthCheck(def.id) === def) applyHealthCheckRun(run)
      return run
    })
  // runHealthCheck reports the underlying provider lifecycle synchronously.
  // The fallback covers setup failures that occur before provider work starts.
  const providerSettled = workSettled ?? promise.then(() => undefined, () => undefined)
  const resultSettled = promise.then(() => undefined, () => undefined)
  const lifecycleSettled = Promise.all([providerSettled, resultSettled]).then(() => undefined)
  const flight = { def, promise, lifecycleSettled }
  checkFlights.set(def.id, flight)
  void lifecycleSettled.then(() => {
    if (checkFlights.get(def.id) === flight) checkFlights.delete(def.id)
  })
  return promise
}

export async function runTargetedDiagnostics(checkIds: readonly string[]): Promise<HealthReport> {
  ensureOnboardingCheck()
  const defs = [...new Set(checkIds)].map((id) => getHealthCheck(id)).filter((def): def is HealthCheckDef => !!def)
  await Promise.all(defs.map(executeSingleFlight))
  return getHealthReport()
}

async function runFullSweep(contentDir: string, projectRoot: string): Promise<HealthReport> {
  void projectRoot
  ensureOnboardingCheck()
  const defs = listHealthChecks()
  const sweep = {
    id: `sweep-${crypto.randomUUID()}`,
    startedAt: new Date().toISOString(),
    completedAt: '',
  }
  await Promise.all(defs.map(executeSingleFlight))
  sweep.completedAt = new Date().toISOString()

  const currentDefs = listHealthChecks()
  if (defs.length === currentDefs.length && defs.every((def, index) => def === currentDefs[index])) {
    setLastFullHealthSweep(sweep)
  }
  const report = getHealthReport()
  appendAudit(contentDir, 'doctor.run', 'system', {
    reportId: report.id,
    registered: report.summary.checks.registered,
    actionRequired: report.summary.incidents.actionRequired,
    watching: report.summary.incidents.watching,
    unknown: report.summary.incidents.unknown,
    overallStatus: report.overallStatus,
  })
  return report
}

export async function runDiagnostics(contentDir: string, projectRoot: string): Promise<HealthReport> {
  if (!fullSweepFlight) {
    fullSweepFlight = runFullSweep(contentDir, projectRoot).finally(() => {
      fullSweepFlight = null
    })
  }
  return fullSweepFlight
}

/** Cached projection; does not execute checks. */
export function getLastReport(): HealthReport {
  ensureOnboardingCheck()
  return getHealthReport()
}

/** Test-only visibility into the execution coordinator. */
export function resetDoctorFlightsForTests(): void {
  fullSweepFlight = null
  checkFlights.clear()
}
