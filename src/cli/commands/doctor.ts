/**
 * `bakin doctor [--full] [--fix] [--delegate] [repair ...]` — offline/full
 * health checks, deterministic repair plan/apply, and delegated repair.
 * Relocated verbatim from cli/bakin.ts (B5.3 command-module split).
 */
import { apiGet, apiPost } from '../http'
import { print } from '../output'
import { exitUsage, exitUnknownSubcommand, promptYesNo } from '../help'
import { renderInkReport } from '../../core/cli/ui/render-report'

type CliDoctorResult = {
  results: Array<{ check: string; status: string; message: string }>
  summary: { total: number; errors: number; warnings: number }
  mode?: 'offline' | 'full'
}

type CliDoctorRepairChange = {
  kind: string
  target: string
  action: string
  description: string
}

type CliDoctorRepairPlanItem = {
  id: string
  checkId: string
  healthCheckId?: string
  pluginId?: string
  checkName?: string
  title: string
  reason: string
  safety: 'safe' | 'manual' | 'destructive'
  requiresConfirmation: boolean
  changes: CliDoctorRepairChange[]
}

type CliDoctorRepairPlan = {
  diagnostics: Array<{ check: string; status: string; message: string; autoFixable?: boolean }>
  items: CliDoctorRepairPlanItem[]
  errors: Array<{ phase: string; healthCheckId: string; message: string }>
  summary: {
    diagnostics: number
    repairableChecks: number
    totalItems: number
    safeItems: number
    blockedItems: number
    planErrors: number
  }
}

type CliDoctorRepairApply = {
  status: 'confirmation_required' | 'applied'
  plan: CliDoctorRepairPlan
  applied: Array<{ id: string; checkId: string; status: string; message: string; changes: CliDoctorRepairChange[] }>
  skipped: Array<{ id: string; checkId: string; status: string; message: string; changes: CliDoctorRepairChange[] }>
  errors: Array<{ phase: string; healthCheckId: string; message: string }>
  verification: Array<{ check: string; status: string; message: string; autoFixable?: boolean }>
  summary: {
    planned: number
    applied: number
    skipped: number
    failed: number
    verificationErrors: number
    verificationWarnings: number
  }
}

type CliDoctorDelegateReport = {
  status: 'confirmation_required' | 'sent' | 'no_unresolved'
  request: Record<string, unknown>
  unresolved: Array<{ check: string; status: string; message: string; autoFixable?: boolean }>
}

function summarizeDoctorResults(results: CliDoctorResult['results']): CliDoctorResult['summary'] {
  return {
    total: results.length,
    errors: results.filter(r => r.status === 'error').length,
    warnings: results.filter(r => r.status === 'warn').length,
  }
}

async function runOfflineDoctor(): Promise<CliDoctorResult> {
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
  const checks = []
  for (const component of [
    mkdirComponent,
    settingsComponent,
    searchComponent,
    searchModelsComponent,
    agentSyncComponent,
    recommendedPluginsComponent,
  ]) {
    try {
      checks.push(await component.check())
    } catch (err) {
      checks.push({
        name: component.name,
        status: 'error' as const,
        message: `check() threw: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }
  const results: CliDoctorResult['results'] = checks.map(check => ({
    check: check.name,
    status: check.status === 'ok' ? 'ok' : check.status === 'warn' ? 'warn' : 'error',
    message: check.remediation ? `${check.message} ${check.remediation}` : check.message,
  }))
  results.push({
    check: 'runtime',
    status: 'warn',
    message: 'Skipped live runtime checks in offline mode. Run `bakin doctor --full` after `bakin start` to verify runtime reachability, agents, LLM providers, and channels.',
  })
  results.push({
    check: 'plugin-assets',
    status: 'warn',
    message: 'Skipped runtime skill projection checks in offline mode. Run `bakin doctor --full` after `bakin start` to verify plugin assets.',
  })
  results.push({
    check: 'server-backed-checks',
    status: 'warn',
    message: 'Skipped plugin, search index, workflow, task, and server health checks that require the Bakin server. Run `bakin doctor --full` after `bakin start`.',
  })
  return { results, summary: summarizeDoctorResults(results), mode: 'offline' }
}

async function runFullDoctor(options: { notifyAgent: boolean }): Promise<CliDoctorResult> {
  const query = options.notifyAgent
    ? '/api/plugins/health/doctor?fresh=true&notifyAgent=true'
    : '/api/plugins/health/doctor?fresh=true'
  const result = await apiGet(query) as CliDoctorResult
  return { ...result, mode: 'full' }
}

async function runDoctorRepairPlan(): Promise<CliDoctorRepairPlan> {
  return await apiGet('/api/plugins/health/doctor/repair/plan') as CliDoctorRepairPlan
}

async function runDoctorRepairApply(): Promise<CliDoctorRepairApply> {
  return await apiPost('/api/plugins/health/doctor/repair/apply', { accepted: true }) as CliDoctorRepairApply
}

async function runDoctorDelegateApply(): Promise<CliDoctorDelegateReport> {
  return await apiPost('/api/plugins/health/doctor/delegate', { accepted: true }) as CliDoctorDelegateReport
}

function doctorRepairExitCode(report: CliDoctorRepairApply): 0 | 1 | 2 {
  if (report.summary.failed > 0 || report.summary.verificationErrors > 0 || report.errors.length > 0) return 1
  if (report.summary.verificationWarnings > 0) return 2
  return 0
}

function printDoctorRepairJson(data: unknown, exitCode: 0 | 1 | 2, error: { code: string; message: string } | null = null): void {
  console.log(JSON.stringify({
    ok: error === null && exitCode !== 1,
    command: 'doctor --fix',
    exitCode,
    data,
    error,
  }, null, 2))
}

function printDoctorRepairPlan(plan: CliDoctorRepairPlan): void {
  console.log('Doctor repair plan')
  console.log(`${plan.summary.safeItems} safe, ${plan.summary.blockedItems} blocked, ${plan.summary.planErrors} plan errors`)
  if (plan.items.length === 0) {
    console.log('No deterministic repairs available.')
    return
  }
  for (const item of plan.items) {
    console.log(`\n[${item.safety.toUpperCase()}] ${item.title}`)
    console.log(`  id: ${item.id}`)
    console.log(`  reason: ${item.reason}`)
    for (const change of item.changes) {
      console.log(`  - ${change.action} ${change.target}: ${change.description}`)
    }
  }
}

function printDoctorRepairApply(report: CliDoctorRepairApply): void {
  console.log('Doctor repair results')
  for (const result of report.applied) {
    const label = result.status === 'applied' ? 'APPLIED' : result.status.toUpperCase()
    console.log(`[${label}] ${result.id}: ${result.message}`)
  }
  for (const result of report.skipped) {
    console.log(`[SKIPPED] ${result.id}: ${result.message}`)
  }
  console.log(`\n${report.summary.applied} applied, ${report.summary.skipped} skipped, ${report.summary.failed} failed`)
  if (report.verification.length > 0) {
    console.log(`${report.summary.verificationErrors} verification errors, ${report.summary.verificationWarnings} verification warnings`)
  }
}

function unresolvedDelegateRows(plan: CliDoctorRepairPlan): CliDoctorRepairPlan['diagnostics'] {
  const safeRepairChecks = new Set(
    plan.items
      .filter(item => item.safety === 'safe')
      .map(item => item.checkId),
  )
  return plan.diagnostics.filter(row => (
    (row.status === 'warn' || row.status === 'error')
    && !safeRepairChecks.has(row.check)
  ))
}

function printDoctorDelegatePreview(plan: CliDoctorRepairPlan, unresolved: CliDoctorRepairPlan['diagnostics']): void {
  console.log('Doctor delegated repair preview')
  if (unresolved.length === 0) {
    console.log('No unresolved findings need delegated repair.')
    return
  }
  for (const row of unresolved) {
    console.log(`[${row.status.toUpperCase()}] ${row.check}: ${row.message}`)
  }
}

function printDoctorDelegateResult(report: CliDoctorDelegateReport): void {
  if (report.status === 'no_unresolved') {
    console.log('No unresolved findings need delegated repair.')
    return
  }
  const request = report.request as { id?: string; taskId?: string; agentId?: string }
  console.log(`Delegated doctor repair ${request.id ?? ''}`)
  if (request.taskId) console.log(`Task: ${request.taskId}`)
  if (request.agentId) console.log(`Agent: ${request.agentId}`)
}

async function printDoctorRepairPlanTui(plan: CliDoctorRepairPlan): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/doctor-repair'), (m) => m.DoctorRepairPlan, { plan })
}

async function printDoctorRepairApplyTui(report: CliDoctorRepairApply, opts: { showBrand?: boolean } = {}): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/doctor-repair'), (m) => m.DoctorRepairApplyReport, { report, showBrand: opts.showBrand })
}

async function printDoctorDelegatePreviewTui(unresolved: CliDoctorRepairPlan['diagnostics']): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/doctor-repair'), (m) => m.DoctorDelegatePreview, { unresolved })
}

async function printDoctorDelegateResultTui(report: CliDoctorDelegateReport, opts: { showBrand?: boolean } = {}): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/doctor-repair'), (m) => m.DoctorDelegateResult, { report, showBrand: opts.showBrand })
}

async function printDoctorRepairRequestsTui(requests: Array<Record<string, unknown>>): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/doctor-repair'), (m) => m.DoctorRepairRequestsReport, { requests })
}

async function printDoctorRepairRequestTui(request: Record<string, unknown>): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/doctor-repair'), (m) => m.DoctorRepairRequestReport, { request })
}

async function printDoctorRepairVerifyTui(requestId: string, result: Record<string, unknown>): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/doctor-repair'), (m) => m.DoctorRepairVerifyReport, { requestId, result })
}

async function confirmDoctorRepair(plan: CliDoctorRepairPlan): Promise<boolean> {
  if (plan.summary.safeItems === 0) return false
  return promptYesNo(`Apply ${plan.summary.safeItems} safe repair item${plan.summary.safeItems === 1 ? '' : 's'}?`)
}

async function confirmDoctorDelegate(unresolved: CliDoctorRepairPlan['diagnostics']): Promise<boolean> {
  if (unresolved.length === 0) return false
  return promptYesNo(`Create a delegated repair task for ${unresolved.length} finding${unresolved.length === 1 ? '' : 's'}?`)
}

async function cmdDoctorFix(options: { json: boolean; yes: boolean; isTTY: boolean }): Promise<void> {
  let acceptedInteractively = false
  if (!options.yes) {
    const plan = await runDoctorRepairPlan()
    if (options.json) {
      if (plan.summary.totalItems === 0) {
        printDoctorRepairJson({ status: 'planned', plan }, 0)
        return
      }
      printDoctorRepairJson(
        { status: 'confirmation_required', plan },
        1,
        { code: 'CONFIRMATION_REQUIRED', message: 'Run `bakin doctor --fix --yes` to apply safe deterministic repairs.' },
      )
      process.exit(1)
    }

    if (options.isTTY) {
      await printDoctorRepairPlanTui(plan)
    } else {
      printDoctorRepairPlan(plan)
    }
    if (plan.summary.totalItems === 0) return

    if (!options.isTTY) {
      console.log('\nRun `bakin doctor --fix --yes` to apply safe deterministic repairs.')
      process.exit(1)
    }
    const accepted = await confirmDoctorRepair(plan)
    if (!accepted) {
      console.log('Repair cancelled.')
      process.exit(1)
    }
    acceptedInteractively = true
  }

  const report = await runDoctorRepairApply()
  const exitCode = doctorRepairExitCode(report)
  if (options.json) {
    printDoctorRepairJson(report, exitCode, exitCode === 1
      ? { code: 'DOCTOR_REPAIR_FAILED', message: 'One or more deterministic doctor repairs failed or did not verify.' }
      : null)
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

async function cmdDoctorDelegate(options: { json: boolean; yes: boolean; isTTY: boolean }): Promise<void> {
  let acceptedInteractively = false
  if (!options.yes) {
    const plan = await runDoctorRepairPlan()
    const unresolved = unresolvedDelegateRows(plan)
    if (options.json) {
      if (unresolved.length === 0) {
        printDoctorRepairJson({ status: 'no_unresolved', plan, unresolved }, 0)
        return
      }
      printDoctorRepairJson(
        { status: 'confirmation_required', plan, unresolved },
        1,
        { code: 'CONFIRMATION_REQUIRED', message: 'Run `bakin doctor --delegate --yes` to create the delegated repair task.' },
      )
      process.exit(1)
    }

    if (options.isTTY) {
      await printDoctorDelegatePreviewTui(unresolved)
    } else {
      printDoctorDelegatePreview(plan, unresolved)
    }
    if (unresolved.length === 0) return
    if (!options.isTTY) {
      console.log('\nRun `bakin doctor --delegate --yes` to create the delegated repair task.')
      process.exit(1)
    }
    const accepted = await confirmDoctorDelegate(unresolved)
    if (!accepted) {
      console.log('Delegated repair cancelled.')
      process.exit(1)
    }
    acceptedInteractively = true
  }

  const report = await runDoctorDelegateApply()
  if (options.json) {
    printDoctorRepairJson(report, 0)
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
      printDoctorRepairJson(result, 0)
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
    if (options.isTTY) {
      await exitUnknownSubcommand('doctor repair', sub, ['list', 'show', 'verify'])
    }
    console.error(`Unknown doctor repair subcommand: ${sub}`)
    process.exit(1)
  }

  const requestId = args[2]
  if (!requestId) {
    const usage = `bakin doctor repair ${sub} <request-id>`
    if (options.isTTY) {
      await exitUsage(usage)
    }
    console.error(`Usage: ${usage}`)
    process.exit(1)
  }

  if (sub === 'show') {
    const result = await apiGet(`/api/plugins/health/doctor/repair/${encodeURIComponent(requestId)}`)
    if (options.json) {
      printDoctorRepairJson(result, 0)
      return
    }
    if (options.isTTY) {
      await printDoctorRepairRequestTui(doctorRepairRequestFromResponse(result))
      return
    }
    print(result)
    return
  }

  if (sub === 'verify') {
    const result = await apiPost(`/api/plugins/health/doctor/repair/${encodeURIComponent(requestId)}/verify`)
    if (options.json) {
      printDoctorRepairJson(result, 0)
      return
    }
    if (options.isTTY) {
      await printDoctorRepairVerifyTui(requestId, doctorRepairRecord(result) ?? {})
      return
    }
    print(result)
    return
  }
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
  if (fix) {
    await cmdDoctorFix({ json, yes, isTTY })
    return
  }
  if (delegate) {
    await cmdDoctorDelegate({ json, yes, isTTY })
    return
  }
  const result = full ? await runFullDoctor({ notifyAgent }) : await runOfflineDoctor()

  if (json) {
    console.log(JSON.stringify({
      ok: result.summary.errors === 0,
      command: 'doctor',
      exitCode: result.summary.errors > 0 ? 1 : result.summary.warnings > 0 ? 2 : 0,
      data: result,
      error: result.summary.errors > 0
        ? { code: 'DOCTOR_ERRORS', message: `${result.summary.errors} doctor check${result.summary.errors === 1 ? '' : 's'} failed` }
        : null,
    }, null, 2))
    if (result.summary.errors > 0) process.exit(1)
    if (result.summary.warnings > 0) process.exit(2)
    return
  }

  if (isTTY) {
    const { DoctorReport } = await import('../../core/cli/ui/doctor')
    const { renderToString } = await import('../../core/cli/ui/render-to-string')
    const { createElement } = await import('react')
    console.log(renderToString(createElement(DoctorReport, {
      results: result.results,
      summary: result.summary,
      mode: result.mode,
    })))
    if (result.summary.errors > 0) process.exit(1)
    if (result.summary.warnings > 0) process.exit(2)
    return
  }

  const statusIcon: Record<string, string> = { ok: 'OK', warn: 'WARN', error: 'FAIL', fixed: 'FIXED' }

  for (const r of result.results) {
    const icon = statusIcon[r.status] || r.status
    console.log(`  [${icon}] ${r.check}: ${r.message}`)
  }

  console.log('')
  const { total, errors, warnings } = result.summary
  if (errors > 0) {
    console.log(`${errors} errors, ${warnings} warnings out of ${total} checks`)
  } else if (warnings > 0) {
    console.log(`${warnings} warnings out of ${total} checks`)
  } else {
    console.log(`All ${total} checks passed`)
  }
  if (errors > 0) process.exit(1)
  if (warnings > 0) process.exit(2)
}


export async function run(args: string[]): Promise<void> {
  await cmdDoctor(args.slice(1))
}
