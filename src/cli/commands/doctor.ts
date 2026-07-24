/**
 * `bakin doctor [--full] [--fix] [--delegate] [repair ...]` — canonical
 * Health reports, targeted deterministic repair, and delegated repair.
 */
import type {
  HealthCheckState,
  HealthIncident,
  HealthIncidentInput,
  HealthObservation,
  HealthObservationStatus,
  HealthRepairApplyResult,
  HealthRepairPlan,
  HealthRepairTarget,
  HealthReport,
  HealthReportStatus,
  SearchReadinessStage,
} from '@makinbakin/sdk/types'
import { apiGet, apiPost } from '../http'
import { print } from '../output'
import { exitUsage, exitUnknownSubcommand, promptYesNo } from '../help'
import { renderInkReport } from '../../core/cli/ui/render-report'

type DoctorMode = 'offline' | 'full'
type DoctorExitCode = 0 | 1 | 2

interface CliDoctorRepairApply {
  planId: string
  basedOnReportId: string
  results: HealthRepairApplyResult[]
  affectedCheckIds: string[]
  verifiedReportId: string
  verifiedIncidentIds: string[]
  report: HealthReport
}

interface CliDoctorDelegateReport {
  status: 'confirmation_required' | 'sent' | 'no_unresolved'
  request: Record<string, unknown>
  incidents: HealthIncident[]
}

interface OfflineCheckResult {
  name: string
  status: 'ok' | 'missing' | 'broken' | 'warn' | 'error'
  message: string
  remediation?: string
}

const coreOwner = { kind: 'core' as const, id: 'core', label: 'Bakin' }
const localGroup = { key: 'offline-local', label: 'Local setup' }
const unverifiedGroup = { key: 'offline-unverified', label: 'Requires server' }

function futureIso(timestamp: string, milliseconds: number): string {
  return new Date(Date.parse(timestamp) + milliseconds).toISOString()
}

function stablePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-|-$/g, '') || 'check'
}

function offlineCheckId(name: string): string {
  return `core.offline.${stablePart(name)}`
}

function offlineIncident(
  name: string,
  status: 'warning' | 'error',
  remediation?: string,
): HealthIncidentInput {
  const id = stablePart(name)
  const base = {
    key: 'attention',
    title: `${name} needs attention`,
    impact: 'Local setup may be incomplete or inconsistent.',
    resources: [{ kind: 'system' as const, id, label: name }],
    resolution: {
      key: 'review-setup',
      type: 'instructions' as const,
      label: 'Review local setup',
      steps: [remediation ?? `Run the ${name} onboarding step again.`] as [string],
    },
  }
  return status === 'error'
    ? { ...base, disposition: 'action_required' }
    : { ...base, disposition: 'watch' }
}

function localObservation(result: OfflineCheckResult, generatedAt: string): HealthObservation {
  const checkId = offlineCheckId(result.name)
  const status: HealthObservationStatus = result.status === 'ok'
    ? 'healthy'
    : result.status === 'warn'
      ? 'warning'
      : 'error'
  const base = {
    id: `${checkId}:status`,
    key: 'status',
    summary: result.message,
    ...(result.remediation ? { detail: result.remediation } : {}),
    checkId,
    checkName: result.name,
    owner: coreOwner,
    group: localGroup,
    checkedAt: generatedAt,
    observedAt: generatedAt,
    staleAt: futureIso(generatedAt, 5 * 60_000),
    snapshot: 'current' as const,
  }
  if (status === 'healthy') return { ...base, status }
  const incident = offlineIncident(result.name, status, result.remediation)
  return {
    ...base,
    status,
    incidentId: `core:offline:${stablePart(result.name)}:attention`,
    incident,
  } as HealthObservation
}

function unknownObservation(
  id: string,
  name: string,
  summary: string,
  generatedAt: string,
  resources: HealthIncidentInput['resources'] = [{ kind: 'system', id }],
): HealthObservation {
  const checkId = offlineCheckId(id)
  return {
    id: `${checkId}:unverified`,
    key: 'unverified',
    status: 'unknown',
    summary,
    checkId,
    checkName: name,
    owner: coreOwner,
    group: unverifiedGroup,
    checkedAt: generatedAt,
    observedAt: generatedAt,
    staleAt: generatedAt,
    snapshot: 'current',
    incidentId: `core:offline:${id}:unverified`,
    incident: {
      key: `${id}-unverified`,
      title: `${name} could not be verified`,
      impact: 'Offline diagnostics could not establish current evidence for this source.',
      disposition: 'watch',
      resources,
      resolution: { key: 'rerun-full', type: 'rerun', label: 'Run full diagnostics' },
    },
  }
}

function observedCheckState(observation: HealthObservation, generatedAt: string): HealthCheckState {
  const executionId = `offline:${observation.checkId}:${generatedAt}`
  return {
    checkId: observation.checkId,
    checkName: observation.checkName,
    description: `Offline local check for ${observation.checkName}.`,
    owner: observation.owner,
    group: observation.group,
    latestExecution: {
      id: executionId,
      checkId: observation.checkId,
      startedAt: generatedAt,
      completedAt: generatedAt,
      outcome: 'observed',
    },
    latestValidSnapshot: { executionId, observations: [observation] },
  }
}

function failedCheckState(observation: HealthObservation, generatedAt: string, code: string, message: string): HealthCheckState {
  return {
    checkId: observation.checkId,
    checkName: observation.checkName,
    description: `Offline verification boundary for ${observation.checkName}.`,
    owner: observation.owner,
    group: observation.group,
    latestExecution: {
      id: `offline:${observation.checkId}:${generatedAt}`,
      checkId: observation.checkId,
      startedAt: generatedAt,
      completedAt: generatedAt,
      outcome: 'failed',
      error: { code, message },
    },
  }
}

function canonicalIncidents(observations: readonly HealthObservation[], generatedAt: string): HealthIncident[] {
  return observations.flatMap((observation): HealthIncident[] => {
    if (observation.status === 'healthy') return []
    return [{
      id: observation.incidentId,
      status: observation.status,
      disposition: observation.incident.disposition,
      // Offline reports are unprojected: raw disposition IS effective.
      effectiveDisposition: observation.incident.disposition,
      title: observation.incident.title,
      impact: observation.incident.impact,
      resources: observation.incident.resources ?? [],
      resolution: observation.incident.resolution,
      observationIds: [observation.id],
      observedAt: observation.observedAt,
      staleAt: observation.staleAt,
      stale: Date.parse(observation.staleAt) <= Date.parse(generatedAt),
    }]
  })
}

function deriveOfflineStatus(checks: readonly HealthCheckState[], incidents: readonly HealthIncident[]): HealthReportStatus {
  if (incidents.some(incident => incident.disposition === 'action_required')) return 'needs_attention'
  if (
    checks.some(check => check.latestExecution.outcome === 'failed' || check.latestExecution.outcome === 'invalid')
    || incidents.some(incident => incident.status === 'unknown' || incident.stale)
  ) return 'unknown_stale'
  if (incidents.some(incident => incident.disposition === 'watch')) return 'degraded'
  return 'healthy'
}

function offlineSearchStages(): SearchReadinessStage[] {
  return ([
    ['engine', 'Engine'],
    ['queries', 'Queries'],
    ['indexes', 'Indexes'],
    ['journal', 'Journal'],
  ] as const).map(([key, label]) => ({
    key,
    label,
    status: 'unknown',
    summary: `${label} readiness is unverified in offline mode.`,
    observedAt: null,
    staleAt: null,
    observationIds: [],
  }))
}

async function runOfflineDoctor(): Promise<HealthReport> {
  const [
    { mkdirComponent },
    { settingsComponent },
    { searchComponent },
    { searchModelsComponent },
    { agentSyncComponent },
    { recommendedPluginsComponent },
  ] = await Promise.all([
    import('../../core/onboarding/mkdir'),
    import('../../core/onboarding/settings'),
    import('../../core/onboarding/search'),
    import('../../core/onboarding/search-models'),
    import('../../core/onboarding/agent-sync'),
    import('../../core/onboarding/recommended-plugins'),
  ])
  const generatedAt = new Date().toISOString()
  const observations: HealthObservation[] = []
  const checks: HealthCheckState[] = []
  for (const component of [
    mkdirComponent,
    settingsComponent,
    searchComponent,
    searchModelsComponent,
    agentSyncComponent,
    recommendedPluginsComponent,
  ]) {
    try {
      const observation = localObservation(await component.check(), generatedAt)
      observations.push(observation)
      checks.push(observedCheckState(observation, generatedAt))
    } catch (error) {
      const observation = unknownObservation(
        component.name,
        component.name,
        `${component.name} could not be checked in offline mode.`,
        generatedAt,
      )
      observations.push({
        ...observation,
        detail: error instanceof Error ? error.message : String(error),
      })
      checks.push(failedCheckState(observation, generatedAt, 'OFFLINE_CHECK_FAILED', 'The local check did not complete.'))
    }
  }

  const unverified = [
    unknownObservation(
      'runtime',
      'Runtime health',
      'Runtime reachability, agents, providers, and channels are unverified offline.',
      generatedAt,
      [{ kind: 'runtime', id: 'active' }],
    ),
    unknownObservation(
      'plugin-assets',
      'Plugin asset projections',
      'Runtime plugin asset projections are unverified offline.',
      generatedAt,
      [{ kind: 'asset', id: 'plugin-projections' }],
    ),
    unknownObservation(
      'server-checks',
      'Server-backed health',
      'Plugin, search, workflow, task, and server health are unverified offline.',
      generatedAt,
      [{ kind: 'system', id: 'server-backed-health' }],
    ),
  ]
  for (const observation of unverified) {
    observations.push(observation)
    checks.push(failedCheckState(
      observation,
      generatedAt,
      'OFFLINE_UNVERIFIED',
      'This source requires a running Bakin server.',
    ))
  }

  const incidents = canonicalIncidents(observations, generatedAt)
  const overallStatus = deriveOfflineStatus(checks, incidents)
  const serverIncidentId = 'core:offline:server-checks:unverified'
  return {
    id: `health-report-offline-${generatedAt}`,
    revision: 0,
    generatedAt,
    overallStatus,
    // No server projection ran — this offline report shows raw dispositions.
    sensitivity: 'developer',
    lastFullSweep: null,
    checks,
    observations,
    incidents,
    subsystems: {
      search: {
        status: 'unknown',
        summary: 'Search readiness is unverified in offline mode.',
        observedAt: null,
        staleAt: null,
        stages: offlineSearchStages(),
        incidentIds: [serverIncidentId],
      },
    },
    summary: {
      checks: {
        registered: checks.length,
        completed: checks.filter(check => check.latestExecution.outcome === 'observed' || check.latestExecution.outcome === 'not_applicable').length,
        failed: checks.filter(check => check.latestExecution.outcome === 'failed').length,
        invalid: checks.filter(check => check.latestExecution.outcome === 'invalid').length,
        notApplicable: checks.filter(check => check.latestExecution.outcome === 'not_applicable').length,
      },
      incidents: {
        actionRequired: incidents.filter(incident => incident.disposition === 'action_required').length,
        watching: incidents.filter(incident => incident.disposition === 'watch').length,
        advisory: incidents.filter(incident => incident.disposition === 'advisory').length,
        unknown: incidents.filter(incident => incident.status === 'unknown').length,
      },
    },
  }
}

async function runFullDoctor(options: { notifyAgent?: boolean } = {}): Promise<HealthReport> {
  return await apiPost('/api/plugins/health/doctor/run', {
    notifyAgent: options.notifyAgent === true,
  }) as HealthReport
}

function doctorExitCode(report: Pick<HealthReport, 'overallStatus'>): DoctorExitCode {
  switch (report.overallStatus) {
    case 'healthy':
      return 0
    case 'degraded':
      return 2
    case 'needs_attention':
    case 'unknown_stale':
      return 1
  }
}

async function runDoctorRepairPlan(report: HealthReport): Promise<HealthRepairPlan> {
  const target: HealthRepairTarget = { type: 'all_actionable', reportId: report.id }
  return await apiPost('/api/plugins/health/doctor/repair/plan', { target }) as HealthRepairPlan
}

async function runDoctorRepairApply(plan: HealthRepairPlan, itemIds: [string, ...string[]]): Promise<CliDoctorRepairApply> {
  return await apiPost('/api/plugins/health/doctor/repair/apply', {
    planId: plan.planId,
    itemIds,
    confirmedItemIds: [],
  }) as CliDoctorRepairApply
}

async function runDoctorDelegateApply(report: HealthReport, incidents: [HealthIncident, ...HealthIncident[]]): Promise<CliDoctorDelegateReport> {
  const target: HealthRepairTarget = {
    type: 'incidents',
    reportId: report.id,
    ids: incidents.map(incident => incident.id) as [string, ...string[]],
  }
  return await apiPost('/api/plugins/health/doctor/delegate', { accepted: true, target }) as CliDoctorDelegateReport
}

function repairApplyExitCode(report: CliDoctorRepairApply): DoctorExitCode {
  if (report.results.some(result => result.status === 'failed')) return 1
  return doctorExitCode(report.report)
}

function printDoctorCommandJson(
  command: string,
  data: unknown,
  exitCode: DoctorExitCode,
  error: { code: string; message: string } | null = null,
): void {
  console.log(JSON.stringify({
    ok: error === null && exitCode !== 1,
    command,
    exitCode,
    data,
    error,
  }, null, 2))
}

function printDoctorRepairPlan(plan: HealthRepairPlan): void {
  const safe = plan.items.filter(item => item.safety === 'safe').length
  const manual = plan.items.filter(item => item.safety === 'manual').length
  const destructive = plan.items.filter(item => item.safety === 'destructive').length
  console.log('Doctor repair plan')
  console.log(`${safe} safe, ${manual} manual, ${destructive} destructive`)
  if (plan.items.length === 0) {
    console.log('No deterministic repairs available.')
    return
  }
  for (const item of plan.items) {
    console.log(`\n[${item.safety.toUpperCase()}] ${item.title}`)
    console.log(`  id: ${item.id}`)
    console.log(`  action: ${item.actionId}`)
    console.log(`  reason: ${item.reason}`)
    for (const change of item.changes) {
      console.log(`  - ${change.action} ${change.target}: ${change.description}`)
    }
  }
}

function printDoctorRepairApply(report: CliDoctorRepairApply): void {
  console.log('Doctor repair results')
  for (const result of report.results) {
    console.log(`[${result.status.toUpperCase()}] ${result.actionId}: ${result.message}`)
  }
  const applied = report.results.filter(result => result.status === 'applied').length
  const skipped = report.results.filter(result => result.status === 'skipped').length
  const failed = report.results.filter(result => result.status === 'failed').length
  console.log(`\n${applied} applied, ${skipped} skipped, ${failed} failed`)
  console.log(`${report.verifiedIncidentIds.length} selected incident(s) remain after verification`)
}

function printDoctorDelegatePreview(incidents: readonly HealthIncident[]): void {
  console.log('Doctor delegated repair preview')
  if (incidents.length === 0) {
    console.log('No action-required incidents need delegated repair.')
    return
  }
  for (const incident of incidents) {
    console.log(`[${incident.status.toUpperCase()}] ${incident.id}: ${incident.title}`)
    console.log(`  ${incident.impact}`)
  }
}

function printDoctorDelegateResult(report: CliDoctorDelegateReport): void {
  if (report.status === 'no_unresolved') {
    console.log('No action-required incidents need delegated repair.')
    return
  }
  const request = report.request as { id?: string; taskId?: string; agentId?: string }
  console.log(`Delegated doctor repair ${request.id ?? ''}`)
  if (request.taskId) console.log(`Task: ${request.taskId}`)
  if (request.agentId) console.log(`Agent: ${request.agentId}`)
  for (const incident of report.incidents) console.log(`  ${incident.id}: ${incident.title}`)
}

async function printDoctorRepairPlanTui(plan: HealthRepairPlan): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/doctor-repair'), module => module.DoctorRepairPlan, { plan })
}

async function printDoctorRepairApplyTui(report: CliDoctorRepairApply, options: { showBrand?: boolean } = {}): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/doctor-repair'), module => module.DoctorRepairApplyReport, {
    report,
    showBrand: options.showBrand,
  })
}

async function printDoctorDelegatePreviewTui(incidents: HealthIncident[]): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/doctor-repair'), module => module.DoctorDelegatePreview, { incidents })
}

async function printDoctorDelegateResultTui(report: CliDoctorDelegateReport, options: { showBrand?: boolean } = {}): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/doctor-repair'), module => module.DoctorDelegateResult, {
    report,
    showBrand: options.showBrand,
  })
}

async function printDoctorRepairRequestsTui(requests: Array<Record<string, unknown>>): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/doctor-repair'), module => module.DoctorRepairRequestsReport, { requests })
}

async function printDoctorRepairRequestTui(request: Record<string, unknown>): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/doctor-repair'), module => module.DoctorRepairRequestReport, { request })
}

async function printDoctorRepairVerifyTui(requestId: string, result: Record<string, unknown>): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/doctor-repair'), module => module.DoctorRepairVerifyReport, { requestId, result })
}

async function confirmDoctorRepair(count: number): Promise<boolean> {
  if (count === 0) return false
  return promptYesNo(`Apply ${count} safe repair item${count === 1 ? '' : 's'}?`)
}

async function confirmDoctorDelegate(count: number): Promise<boolean> {
  if (count === 0) return false
  return promptYesNo(`Create a delegated repair task for ${count} incident${count === 1 ? '' : 's'}?`)
}

async function cmdDoctorFix(options: { json: boolean; yes: boolean; isTTY: boolean }): Promise<void> {
  const current = await runFullDoctor()
  const plan = await runDoctorRepairPlan(current)
  const safeItemIds = plan.items.filter(item => item.safety === 'safe').map(item => item.id)
  if (safeItemIds.length === 0) {
    if (options.json) {
      printDoctorCommandJson('doctor --fix', { status: 'no_safe_repairs', plan }, 0)
    } else if (options.isTTY) {
      await printDoctorRepairPlanTui(plan)
    } else {
      printDoctorRepairPlan(plan)
    }
    return
  }

  let acceptedInteractively = false
  if (!options.yes) {
    if (options.json) {
      printDoctorCommandJson(
        'doctor --fix',
        { status: 'confirmation_required', plan },
        1,
        { code: 'CONFIRMATION_REQUIRED', message: 'Run `bakin doctor --fix --yes` to apply the safe plan items.' },
      )
      process.exit(1)
    }
    if (options.isTTY) await printDoctorRepairPlanTui(plan)
    else printDoctorRepairPlan(plan)

    if (!options.isTTY) {
      console.log('\nRun `bakin doctor --fix --yes` to apply the safe plan items.')
      process.exit(1)
    }
    if (!await confirmDoctorRepair(safeItemIds.length)) {
      console.log('Repair cancelled.')
      process.exit(1)
    }
    acceptedInteractively = true
  }

  const report = await runDoctorRepairApply(plan, safeItemIds as [string, ...string[]])
  const exitCode = repairApplyExitCode(report)
  if (options.json) {
    printDoctorCommandJson(
      'doctor --fix',
      report,
      exitCode,
      exitCode === 1 && report.results.some(result => result.status === 'failed')
        ? { code: 'DOCTOR_REPAIR_FAILED', message: 'One or more selected Health repair actions failed.' }
        : null,
    )
    if (exitCode !== 0) process.exit(exitCode)
    return
  }
  if (options.isTTY) {
    if (acceptedInteractively) console.log('')
    await printDoctorRepairApplyTui(report, { showBrand: !acceptedInteractively })
  } else {
    printDoctorRepairApply(report)
  }
  if (exitCode !== 0) process.exit(exitCode)
}

function actionRequiredIncidents(report: HealthReport): HealthIncident[] {
  // Effective disposition (#690) — the CLI acts on the same story every other surface tells.
  return report.incidents.filter(incident => incident.effectiveDisposition === 'action_required')
}

async function cmdDoctorDelegate(options: { json: boolean; yes: boolean; isTTY: boolean }): Promise<void> {
  const current = await runFullDoctor()
  const incidents = actionRequiredIncidents(current)
  if (incidents.length === 0) {
    const result = { status: 'no_action_required', reportId: current.id, incidents: [] }
    if (options.json) printDoctorCommandJson('doctor --delegate', result, 0)
    else if (options.isTTY) await printDoctorDelegatePreviewTui([])
    else printDoctorDelegatePreview([])
    return
  }

  let acceptedInteractively = false
  if (!options.yes) {
    if (options.json) {
      printDoctorCommandJson(
        'doctor --delegate',
        { status: 'confirmation_required', reportId: current.id, incidents },
        1,
        { code: 'CONFIRMATION_REQUIRED', message: 'Run `bakin doctor --delegate --yes` to create the delegated repair task.' },
      )
      process.exit(1)
    }
    if (options.isTTY) await printDoctorDelegatePreviewTui(incidents)
    else printDoctorDelegatePreview(incidents)
    if (!options.isTTY) {
      console.log('\nRun `bakin doctor --delegate --yes` to create the delegated repair task.')
      process.exit(1)
    }
    if (!await confirmDoctorDelegate(incidents.length)) {
      console.log('Delegated repair cancelled.')
      process.exit(1)
    }
    acceptedInteractively = true
  }

  const report = await runDoctorDelegateApply(current, incidents as [HealthIncident, ...HealthIncident[]])
  if (options.json) {
    printDoctorCommandJson('doctor --delegate', report, 0)
    return
  }
  if (options.isTTY) {
    if (acceptedInteractively) console.log('')
    await printDoctorDelegateResultTui(report, { showBrand: !acceptedInteractively })
  } else {
    printDoctorDelegateResult(report)
  }
}

function doctorRepairRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function doctorRepairRequestFromResponse(result: unknown): Record<string, unknown> {
  const data = doctorRepairRecord(result) ?? {}
  return doctorRepairRecord(data.request) ?? data
}

function doctorRepairRequestList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => doctorRepairRecord(item) !== null)
    : []
}

async function cmdDoctorRepair(args: string[], options: { json: boolean; isTTY: boolean }): Promise<void> {
  const sub = args[1] ?? 'list'
  if (sub === 'list') {
    const result = await apiGet('/api/plugins/health/doctor/repair') as { requests?: Array<Record<string, unknown>> }
    if (options.json) {
      printDoctorCommandJson('doctor repair list', result, 0)
      return
    }
    const requests = doctorRepairRequestList(result.requests)
    if (options.isTTY) {
      await printDoctorRepairRequestsTui(requests)
      return
    }
    if (requests.length === 0) {
      console.log('No doctor repair requests.')
      return
    }
    for (const request of requests) {
      console.log(`${request.id ?? '(unknown)'}  ${request.status ?? 'unknown'}  task=${request.taskId ?? '-'}`)
    }
    return
  }

  if (sub !== 'show' && sub !== 'verify') {
    if (options.isTTY) await exitUnknownSubcommand('doctor repair', sub, ['list', 'show', 'verify'])
    console.error(`Unknown doctor repair subcommand: ${sub}`)
    process.exit(1)
  }

  const requestId = args[2]
  if (!requestId) {
    const usage = `bakin doctor repair ${sub} <request-id>`
    if (options.isTTY) await exitUsage(usage)
    console.error(`Usage: ${usage}`)
    process.exit(1)
  }

  if (sub === 'show') {
    const result = await apiGet(`/api/plugins/health/doctor/repair/${encodeURIComponent(requestId)}`)
    if (options.json) {
      printDoctorCommandJson('doctor repair show', result, 0)
      return
    }
    if (options.isTTY) {
      await printDoctorRepairRequestTui(doctorRepairRequestFromResponse(result))
      return
    }
    print(result)
    return
  }

  const result = await apiPost(`/api/plugins/health/doctor/repair/${encodeURIComponent(requestId)}/verify`)
  if (options.json) {
    printDoctorCommandJson('doctor repair verify', result, 0)
    return
  }
  if (options.isTTY) {
    await printDoctorRepairVerifyTui(requestId, doctorRepairRecord(result) ?? {})
    return
  }
  print(result)
}

function printPlainDoctor(report: HealthReport): void {
  const represented = new Set<string>()
  for (const observation of report.observations) {
    represented.add(observation.checkId)
    const status = observation.snapshot === 'last_known'
      ? 'LAST KNOWN'
      : observation.status === 'healthy'
        ? 'OK'
        : observation.status === 'warning'
          ? 'WARN'
          : observation.status === 'error'
            ? 'FAIL'
            : 'UNKNOWN'
    const summary = observation.snapshot === 'last_known'
      ? `Last known: ${observation.summary}`
      : observation.summary
    console.log(`  [${status}] ${observation.checkId}: ${summary}`)
  }
  for (const check of report.checks) {
    if (represented.has(check.checkId) || check.latestExecution.outcome === 'observed') continue
    const status = check.latestExecution.outcome === 'not_applicable' ? 'N/A' : 'UNKNOWN'
    const message = check.latestExecution.reason ?? check.latestExecution.error?.message ?? 'No current evidence.'
    console.log(`  [${status}] ${check.checkId}: ${message}`)
  }
  console.log('')
  const incidents = report.summary.incidents
  console.log(`${report.overallStatus}: ${incidents.actionRequired} action required, ${incidents.watching} watching, ${incidents.advisory} advisory, ${incidents.unknown} unknown`)
}

/**
 * The ack/snooze verbs (health trust overhaul): quiet an incident you have
 * seen without hiding it. action_required is snooze-only server-side.
 */
async function cmdDoctorAck(args: string[], opts: { json: boolean }): Promise<void> {
  const verb = args[0]!
  if (verb === 'acks') {
    const { records } = await apiGet('/api/plugins/health/doctor/acks') as {
      records: Array<{ incidentId: string; mode: string; at: string; until?: string; tierAtAck: string }>
    }
    if (opts.json) {
      console.log(JSON.stringify({ records }, null, 2))
      return
    }
    if (records.length === 0) {
      console.log('No acknowledged or snoozed incidents.')
      return
    }
    for (const record of records) {
      const window = record.mode === 'snooze' && record.until ? ` until ${record.until}` : ''
      console.log(`  ${record.incidentId} — ${record.mode}${window} (was ${record.tierAtAck}, ${record.at})`)
    }
    return
  }

  const incidentId = args[1]
  if (!incidentId) {
    await exitUsage(`bakin doctor ${verb} <incidentId>${verb === 'snooze' ? ' [--for 24h|7d]' : ''}`)
    return
  }
  const action = verb === 'unack' ? 'clear' : verb
  const forIndex = args.indexOf('--for')
  const body: Record<string, string> = { incidentId, action }
  if (action === 'snooze') {
    const window = forIndex !== -1 ? args[forIndex + 1] : '24h'
    if (window !== '24h' && window !== '7d') {
      await exitUsage('bakin doctor snooze <incidentId> [--for 24h|7d]')
      return
    }
    body.for = window
  }
  const result = await apiPost('/api/plugins/health/doctor/ack', body) as { incidentId: string; action: string }
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  const past = result.action === 'clear' ? 'un-acked' : result.action === 'snooze' ? 'snoozed' : 'acknowledged'
  console.log(`Incident ${result.incidentId} ${past}. It stays visible in the Acknowledged section and re-surfaces on material change.`)
}

async function cmdDoctor(args: string[] = process.argv.slice(2)): Promise<void> {
  const json = args.includes('--json')
  const full = args.includes('--full')
  const notifyAgent = args.includes('--notify-agent')
  const fix = args.includes('--fix')
  const delegate = args.includes('--delegate')
  const yes = args.includes('--yes')
  const isTTY = Boolean(process.stdout.isTTY)
  if (args[0] === 'repair') {
    await cmdDoctorRepair(args, { json, isTTY })
    return
  }
  if (args[0] === 'acks' || args[0] === 'ack' || args[0] === 'snooze' || args[0] === 'unack') {
    await cmdDoctorAck(args, { json })
    return
  }
  if (fix) {
    await cmdDoctorFix({ json, yes, isTTY })
    return
  }
  if (delegate) {
    await cmdDoctorDelegate({ json, yes, isTTY })
    return
  }

  const mode: DoctorMode = full ? 'full' : 'offline'
  const report = full ? await runFullDoctor({ notifyAgent }) : await runOfflineDoctor()
  const exitCode = doctorExitCode(report)
  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else if (isTTY) {
    const { DoctorReport } = await import('../../core/cli/ui/doctor')
    const { renderToString } = await import('../../core/cli/ui/render-to-string')
    const { createElement } = await import('react')
    console.log(renderToString(createElement(DoctorReport, { report, mode })))
  } else {
    printPlainDoctor(report)
  }
  if (exitCode !== 0) process.exit(exitCode)
}

export async function run(args: string[]): Promise<void> {
  await cmdDoctor(args.slice(1))
}
