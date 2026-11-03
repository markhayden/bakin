/** Canonical Health facade: diagnostics plus cron escalation. */
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
import { SHARED_ENGINE_ACTIONS } from '@bakin/core/health/authorize-mutation'
import { getContentDir } from './content-dir'
import { getHealthRepairAction, listHealthChecks, listHealthRepairActions, registerCoreHealthRepairAction } from './health-check-registry'
import { onboardRepair, ONBOARD_ACTION, type OnboardRepairDeps } from './doctor-onboard-repair'
import { DIAGNOSE_ACTION, FALLBACK_TURN_BUDGET, diagnoseRepair, type DiagnoseRepairDeps } from './doctor-diagnose-repair'
import { getExecTool } from './exec-tools/registry'
import { createDoctorRefreshCoordinator, healthChecksAffectedByEvent } from './doctor-refresh'
import { onServerEvent } from './server-events'

export { runDetailedPluginHealthChecks, runPluginHealthChecks, runHealthCheck, type DetailedHealthCheckRun } from './doctor-checks'
export { getHealthReport } from './doctor-report-cache'
export { getLastReport, resetDoctorFlightsForTests, runTargetedDiagnostics }

const log = createLogger('doctor')
let doctorTimer: NodeJS.Timeout | null = null
let refreshTimer: ReturnType<typeof setInterval> | null = null
let stopRefresh: (() => void) | null = null
let stopAutoClose: (() => void) | null = null

/** One doctor cycle: full sweep → escalation → auto-close of verified repair tasks. */
async function runCycle(contentDir: string, projectRoot: string): Promise<void> {
  const report = await runDiagnostics(contentDir, projectRoot)
  const { escalateCronIncidents } = await import('./doctor-escalation')
  await escalateCronIncidents(report, contentDir, projectRoot)
  const { reconcileRepairRequests } = await import('./doctor-autoclose')
  await reconcileRepairRequests(contentDir)
}

function doctorIntervalMs(): number {
  return getSettings().doctor.intervalMs
}

/** The onboarding engine behind `core.onboard`: `bakin onboard --yes`'s runner, each component as its own operation. */
function realOnboardRepairDeps(): OnboardRepairDeps {
  return {
    runOnboard: async (opts, installComponent) => (await import('./onboarding')).runOnboard(opts, installComponent),
    runComponent: async (name, options) => {
      const [{ runLocal }, { componentInstallOperation }, { installableComponent }] = await Promise.all([
        import('./operations'),
        import('./onboarding/operation'),
        import('./onboarding'),
      ])
      const view = await runLocal(componentInstallOperation(installableComponent(name), options, 'system'))
      const body = view.result?.body
      if (body && typeof body === 'object' && 'result' in body) return (body as { result: Awaited<ReturnType<OnboardRepairDeps['runComponent']>> }).result
      return { name, status: 'failed', message: view.outcome?.message ?? `${name} did not finish (${view.status})`, durationMs: 0 }
    },
  }
}

/** The roots the doctor was started with; core actions that open tasks need them outside a cycle. */
let doctorRoots: { contentDir: string; projectRoot: string } | null = null

/**
 * The fallback lane behind `core.diagnose` (self-healing 1.5): delegation
 * through the ONE delegate, the brief's fallback sections feature-detected
 * from the exec-tool registry (Terminal is a Bits plugin; the hand-back and
 * repair tools land with the repair engine — the brief never names a tool
 * this release lacks).
 */
function realDiagnoseDeps(): DiagnoseRepairDeps {
  return {
    delegate: async (options) => (await import('./doctor-delegate')).delegateDoctorRepair(options),
    roots: () => doctorRoots ?? { contentDir: getContentDir(), projectRoot: process.cwd() },
    report: () => getHealthReport(),
    fallback: () => ({
      attempts: [],
      turnBudget: { total: FALLBACK_TURN_BUDGET, remaining: FALLBACK_TURN_BUDGET },
      proposableActions: listHealthRepairActions().map((action) => action.id).filter((id) => !SHARED_ENGINE_ACTIONS.includes(id)),
      terminalAvailable: getExecTool('bakin_exec_terminal_session') !== undefined,
      tools: {
        handback: getExecTool('bakin_exec_health_handback') !== undefined,
        repair: getExecTool('bakin_exec_health_repair') !== undefined,
      },
      // The repair engine (PR5) counts turns and settles the task; until it lands the brief states the convention only.
      enforced: false,
    }),
  }
}

/**
 * Core-owned repair actions register once, beside the core checks:
 * `core.onboard` (1.3c) and the shared engine action `core.diagnose` (1.5).
 * Called before plugins activate so every owner's catalog can reference the
 * engine action, and again by every entry point (idempotent).
 */
export function ensureCoreRepairActions(): void {
  if (!getHealthRepairAction(`core.${ONBOARD_ACTION}`)) registerCoreHealthRepairAction(onboardRepair(realOnboardRepairDeps()))
  if (!getHealthRepairAction(`core.${DIAGNOSE_ACTION}`)) registerCoreHealthRepairAction(diagnoseRepair(realDiagnoseDeps()))
}

export async function runDiagnostics(contentDir: string, projectRoot: string): Promise<HealthReport> {
  doctorRoots = { contentDir, projectRoot }
  ensureCoreRepairActions()
  return executeDiagnostics(contentDir, projectRoot)
}

export function start(contentDir: string, projectRoot: string): void {
  doctorRoots = { contentDir, projectRoot }
  ensureCoreRepairActions()
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
  runCycle(contentDir, projectRoot).catch((error) => log.error('Doctor startup check failed', error))
  import('./doctor-autoclose')
    .then(({ startAutoCloseWatcher }) => { stopAutoClose = startAutoCloseWatcher(contentDir) })
    .catch((error) => log.error('Doctor auto-close watcher failed to start', error))

  doctorTimer = setInterval(() => {
    runCycle(contentDir, projectRoot).catch((error) => log.error('Doctor periodic check failed', error))
  }, doctorIntervalMs())
  log.info('Doctor started', { intervalMs: doctorIntervalMs() })
}

export function stop(): void {
  stopRefresh?.()
  stopRefresh = null
  stopAutoClose?.()
  stopAutoClose = null
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = null
  if (!doctorTimer) return
  clearInterval(doctorTimer)
  doctorTimer = null
  log.info('Doctor stopped')
}
