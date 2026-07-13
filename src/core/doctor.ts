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

export { runDetailedPluginHealthChecks, runPluginHealthChecks, runHealthCheck, type DetailedHealthCheckRun } from './doctor-checks'
export { getHealthReport } from './doctor-report-cache'
export { getLastReport, resetDoctorFlightsForTests, runTargetedDiagnostics }

const log = createLogger('doctor')
let doctorTimer: NodeJS.Timeout | null = null

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
  if (!doctorTimer) return
  clearInterval(doctorTimer)
  doctorTimer = null
  log.info('Doctor stopped')
}
