/** Canonical Health facade: diagnostics plus notification and cron escalation. */
import type { HealthReport } from '../../packages/core/src/plugin-types'
import {
  getLastReport,
  resetDoctorFlightsForTests,
  runDiagnostics as executeDiagnostics,
  runTargetedDiagnostics,
} from './doctor-execution'
import { createLogger } from './logger'
import { getSettings } from './settings'
import { getCachedHealthCheckState, getHealthReport } from './doctor-report-cache'
import { listHealthChecks } from './health-check-registry'
import { createDoctorRefreshCoordinator, healthChecksAffectedByEvent } from './doctor-refresh'
import { onServerEvent } from './server-events'

export { runDetailedPluginHealthChecks, runPluginHealthChecks, runHealthCheck, type DetailedHealthCheckRun } from './doctor-checks'
export { getHealthReport } from './doctor-report-cache'
export { getLastReport, resetDoctorFlightsForTests, runTargetedDiagnostics }

const log = createLogger('doctor')
let doctorTimer: NodeJS.Timeout | null = null
let refreshTimer: ReturnType<typeof setInterval> | null = null
let stopRefresh: (() => void) | null = null

function doctorIntervalMs(): number {
  return getSettings().doctor.intervalMs
}

export async function runDiagnostics(
  contentDir: string,
  projectRoot: string,
  options: { notifyAgent?: boolean } = {},
): Promise<HealthReport> {
  const report = await executeDiagnostics(contentDir, projectRoot)
  if (options.notifyAgent) {
    const { notifyActionRequiredIncidents } = await import('./doctor-escalation')
    await notifyActionRequiredIncidents(report)
  }
  return report
}

export function start(contentDir: string, projectRoot: string): void {
  stop()
  const refresh = createDoctorRefreshCoordinator({
    checks: () => listHealthChecks().map((check) => {
      const execution = getCachedHealthCheckState(check.id)?.latestExecution
      return {
        id: check.id,
        maxAgeMs: check.maxAgeMs ?? doctorIntervalMs(),
        completedAt: execution ? Date.parse(execution.completedAt) : null,
        failed: execution?.outcome === 'failed' || execution?.outcome === 'invalid',
      }
    }),
    run: (id, afterInFlight) => runTargetedDiagnostics([id], { afterInFlight }),
    project: () => { getHealthReport() },
    onError: (error) => log.error('Background Health refresh failed', error),
  })
  const unsubscribe = onServerEvent((event) => {
    refresh.invalidate(healthChecksAffectedByEvent(event, listHealthChecks()))
  })
  stopRefresh = () => { unsubscribe(); refresh.stop() }
  refreshTimer = setInterval(() => {
    void refresh.tick(Date.now()).catch((error) => log.error('Health projection failed', error))
  }, 1000)
  refreshTimer.unref?.()
  runDiagnostics(contentDir, projectRoot)
    .then(async (report) => {
      const { escalateCronIncidents } = await import('./doctor-escalation')
      return escalateCronIncidents(report, contentDir, projectRoot)
    })
    .catch((error) => log.error('Doctor startup check failed', error))

  doctorTimer = setInterval(() => {
    runDiagnostics(contentDir, projectRoot)
      .then(async (report) => {
        const { escalateCronIncidents } = await import('./doctor-escalation')
        return escalateCronIncidents(report, contentDir, projectRoot)
      })
      .catch((error) => log.error('Doctor periodic check failed', error))
  }, doctorIntervalMs())
  log.info('Doctor started', { intervalMs: doctorIntervalMs() })
}

export function stop(): void {
  stopRefresh?.()
  stopRefresh = null
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = null
  if (!doctorTimer) return
  clearInterval(doctorTimer)
  doctorTimer = null
  log.info('Doctor stopped')
}
