/**
 * Explicit doctor repair orchestration.
 *
 * Normal diagnostics stay report-only. This module is the deterministic repair
 * boundary: callers must ask for a plan, then explicitly accept before any
 * check-owned repair handler can mutate state.
 */
import { appendAudit } from './audit'
import { runDetailedPluginHealthChecks } from './doctor'
import { getHealthCheck } from './health-check-registry'
import type {
  HealthCheckDef,
  HealthCheckResult,
  HealthRepairApplyResult,
  HealthRepairPlanItem,
} from '../../packages/core/src/plugin-types'

export interface DoctorRepairPlanItem extends HealthRepairPlanItem {
  healthCheckId: string
  pluginId: string
  checkName: string
}

export interface DoctorRepairError {
  phase: 'plan' | 'apply' | 'verify'
  healthCheckId: string
  pluginId: string
  checkName: string
  message: string
}

export interface DoctorRepairPlanSummary {
  diagnostics: number
  repairableChecks: number
  totalItems: number
  safeItems: number
  blockedItems: number
  planErrors: number
}

export interface DoctorRepairPlanReport {
  diagnostics: HealthCheckResult[]
  items: DoctorRepairPlanItem[]
  errors: DoctorRepairError[]
  summary: DoctorRepairPlanSummary
}

export interface DoctorRepairApplySummary {
  planned: number
  applied: number
  skipped: number
  failed: number
  verificationErrors: number
  verificationWarnings: number
}

export interface DoctorRepairApplyReport {
  status: 'confirmation_required' | 'applied'
  plan: DoctorRepairPlanReport
  applied: HealthRepairApplyResult[]
  skipped: HealthRepairApplyResult[]
  errors: DoctorRepairError[]
  verification: HealthCheckResult[]
  summary: DoctorRepairApplySummary
}

export interface DoctorRepairOptions {
  contentDir: string
  projectRoot: string
}

export interface DoctorRepairApplyOptions extends DoctorRepairOptions {
  accepted: boolean
  itemIds?: string[]
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function needsRepair(row: HealthCheckResult): boolean {
  return row.status === 'warn' || row.status === 'error'
}

function enrichPlanItem(def: HealthCheckDef, item: HealthRepairPlanItem): DoctorRepairPlanItem {
  return {
    ...item,
    healthCheckId: def.id,
    pluginId: def.pluginId,
    checkName: def.name,
  }
}

function summarizePlan(
  diagnostics: HealthCheckResult[],
  items: DoctorRepairPlanItem[],
  errors: DoctorRepairError[],
): DoctorRepairPlanSummary {
  return {
    diagnostics: diagnostics.length,
    repairableChecks: new Set(items.map(item => item.healthCheckId)).size,
    totalItems: items.length,
    safeItems: items.filter(item => item.safety === 'safe').length,
    blockedItems: items.filter(item => item.safety !== 'safe').length,
    planErrors: errors.length,
  }
}

async function verifyHealthCheck(def: HealthCheckDef): Promise<HealthCheckResult[]> {
  try {
    const rows = await def.run()
    if (!Array.isArray(rows)) {
      return [{
        check: def.id,
        status: 'error',
        message: `Plugin health check returned non-array: ${typeof rows}`,
        autoFixable: false,
      }]
    }
    return rows
  } catch (err) {
    return [{
      check: def.id,
      status: 'error',
      message: `Plugin health check threw: ${errorMessage(err)}`,
      autoFixable: false,
    }]
  }
}

export async function planDoctorRepair(options: DoctorRepairOptions): Promise<DoctorRepairPlanReport> {
  void options.projectRoot
  const groups = await runDetailedPluginHealthChecks()
  const diagnostics = groups.flatMap(group => group.results)
  const items: DoctorRepairPlanItem[] = []
  const errors: DoctorRepairError[] = []

  for (const { def, results } of groups) {
    if (!def.repair || !results.some(needsRepair)) continue
    try {
      const planned = await def.repair.plan(results.filter(needsRepair))
      items.push(...planned.map(item => enrichPlanItem(def, item)))
    } catch (err) {
      errors.push({
        phase: 'plan',
        healthCheckId: def.id,
        pluginId: def.pluginId,
        checkName: def.name,
        message: errorMessage(err),
      })
    }
  }

  const report = {
    diagnostics,
    items,
    errors,
    summary: summarizePlan(diagnostics, items, errors),
  }

  appendAudit(options.contentDir, 'doctor.fix.planned', 'system', {
    diagnostics: report.summary.diagnostics,
    totalItems: report.summary.totalItems,
    safeItems: report.summary.safeItems,
    blockedItems: report.summary.blockedItems,
    planErrors: report.summary.planErrors,
  })

  return report
}

export async function applyDoctorRepair(options: DoctorRepairApplyOptions): Promise<DoctorRepairApplyReport> {
  const plan = await planDoctorRepair(options)
  const selectedIds = options.itemIds ? new Set(options.itemIds) : null
  const selectedItems = selectedIds
    ? plan.items.filter(item => selectedIds.has(item.id))
    : plan.items

  if (!options.accepted) {
    return {
      status: 'confirmation_required',
      plan,
      applied: [],
      skipped: [],
      errors: [],
      verification: [],
      summary: {
        planned: selectedItems.length,
        applied: 0,
        skipped: 0,
        failed: 0,
        verificationErrors: 0,
        verificationWarnings: 0,
      },
    }
  }

  const safeItems = selectedItems.filter(item => item.safety === 'safe')
  const blockedItems = selectedItems.filter(item => item.safety !== 'safe')
  const skipped: HealthRepairApplyResult[] = blockedItems.map(item => ({
    id: item.id,
    checkId: item.checkId,
    status: 'skipped',
    message: `Skipped ${item.safety} repair item; deterministic doctor repair only applies safe items.`,
    changes: item.changes,
  }))

  const groupsByCheck = new Map<string, DoctorRepairPlanItem[]>()
  for (const item of safeItems) {
    const existing = groupsByCheck.get(item.healthCheckId) ?? []
    existing.push(item)
    groupsByCheck.set(item.healthCheckId, existing)
  }

  const applied: HealthRepairApplyResult[] = []
  const errors: DoctorRepairError[] = [...plan.errors]

  for (const [healthCheckId, items] of groupsByCheck.entries()) {
    const def = getHealthCheck(healthCheckId)
    if (!def?.repair) continue
    try {
      const results = await def.repair.apply(items)
      applied.push(...results)
    } catch (err) {
      const message = errorMessage(err)
      errors.push({
        phase: 'apply',
        healthCheckId: def.id,
        pluginId: def.pluginId,
        checkName: def.name,
        message,
      })
      applied.push({
        id: `${def.id}.apply-error`,
        checkId: def.id,
        status: 'failed',
        message,
        changes: items.flatMap(item => item.changes),
      })
    }
  }

  const verification: HealthCheckResult[] = []
  for (const healthCheckId of groupsByCheck.keys()) {
    const def = getHealthCheck(healthCheckId)
    if (!def) continue
    try {
      verification.push(...await verifyHealthCheck(def))
    } catch (err) {
      errors.push({
        phase: 'verify',
        healthCheckId: def.id,
        pluginId: def.pluginId,
        checkName: def.name,
        message: errorMessage(err),
      })
    }
  }

  const failed = applied.filter(result => result.status === 'failed').length
  const verificationErrors = verification.filter(row => row.status === 'error').length
  const verificationWarnings = verification.filter(row => row.status === 'warn').length

  appendAudit(options.contentDir, failed > 0 ? 'doctor.fix.failed' : 'doctor.fix.applied', 'system', {
    planned: selectedItems.length,
    applied: applied.filter(result => result.status === 'applied').length,
    skipped: skipped.length,
    failed,
  })
  appendAudit(options.contentDir, 'doctor.fix.verified', 'system', {
    checks: groupsByCheck.size,
    errors: verificationErrors,
    warnings: verificationWarnings,
  })

  return {
    status: 'applied',
    plan,
    applied,
    skipped,
    errors,
    verification,
    summary: {
      planned: selectedItems.length,
      applied: applied.filter(result => result.status === 'applied').length,
      skipped: skipped.length,
      failed,
      verificationErrors,
      verificationWarnings,
    },
  }
}
