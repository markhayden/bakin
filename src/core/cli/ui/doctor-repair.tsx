import { Box } from 'ink'
import type { TuiStatus } from './style-tokens'
import {
  FindingRows,
  NextActions,
  ScreenHeader,
  Section,
  SummaryStrip,
  type FindingRow,
  type SummaryItem,
} from './tui'

export interface DoctorRepairDiagnostic {
  check: string
  status: string
  message: string
  autoFixable?: boolean
}

export interface DoctorRepairChange {
  kind: string
  target: string
  action: string
  description: string
}

export interface DoctorRepairPlanItem {
  id: string
  checkId: string
  healthCheckId?: string
  pluginId?: string
  checkName?: string
  title: string
  reason: string
  safety: 'safe' | 'manual' | 'destructive'
  requiresConfirmation: boolean
  changes: DoctorRepairChange[]
}

export interface DoctorRepairPlanData {
  diagnostics: DoctorRepairDiagnostic[]
  items: DoctorRepairPlanItem[]
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

export interface DoctorRepairApplyData {
  status: 'confirmation_required' | 'applied'
  plan: DoctorRepairPlanData
  applied: Array<{ id: string; checkId: string; status: string; message: string; changes: DoctorRepairChange[] }>
  skipped: Array<{ id: string; checkId: string; status: string; message: string; changes: DoctorRepairChange[] }>
  errors: Array<{ phase: string; healthCheckId: string; message: string }>
  verification: DoctorRepairDiagnostic[]
  summary: {
    planned: number
    applied: number
    skipped: number
    failed: number
    verificationErrors: number
    verificationWarnings: number
  }
}

export interface DoctorDelegateReportData {
  status: 'confirmation_required' | 'sent' | 'no_unresolved'
  request: Record<string, unknown>
  unresolved: DoctorRepairDiagnostic[]
}

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return count === 1 ? singular : pluralLabel
}

function statusForDiagnostic(status: string): TuiStatus {
  switch (status) {
    case 'ok':
      return 'ok'
    case 'fixed':
    case 'applied':
      return 'applied'
    case 'warn':
      return 'warn'
    case 'error':
    case 'failed':
      return 'fail'
    case 'skipped':
      return 'skip'
    default:
      return 'run'
  }
}

function statusForSafety(safety: DoctorRepairPlanItem['safety']): TuiStatus {
  if (safety === 'safe') return 'ready'
  if (safety === 'manual') return 'warn'
  return 'blocked'
}

function changesDetail(changes: DoctorRepairChange[]): string | undefined {
  if (changes.length === 0) return undefined
  return changes
    .map(change => `${change.action} ${change.target}: ${change.description}`)
    .join('; ')
}

function itemRows(items: DoctorRepairPlanItem[]): FindingRow[] {
  return items.map((item) => {
    const reason = item.reason.replace(/[.!?]+$/, '')
    const changes = changesDetail(item.changes)
    return {
      status: statusForSafety(item.safety),
      label: item.checkId,
      message: item.title,
      detail: changes ? `Reason: ${reason}. Change: ${changes}` : `Reason: ${item.reason}`,
    }
  })
}

function diagnosticRows(rows: DoctorRepairDiagnostic[]): FindingRow[] {
  return rows.map(row => ({
    status: statusForDiagnostic(row.status),
    label: row.check,
    message: row.message,
  }))
}

function errorRows(errors: DoctorRepairPlanData['errors'] | DoctorRepairApplyData['errors']): FindingRow[] {
  return errors.map(error => ({
    status: 'fail',
    label: error.healthCheckId || error.phase,
    message: error.message,
    detail: `Phase: ${error.phase}`,
  }))
}

function repairPlanSummary(plan: DoctorRepairPlanData): SummaryItem[] {
  const manualItems = plan.items.filter(item => item.safety === 'manual' || item.safety === 'destructive').length
  const items: SummaryItem[] = [
    { label: 'safe', value: plan.summary.safeItems, status: plan.summary.safeItems > 0 ? 'ready' : 'ok' },
    { label: 'manual', value: manualItems, status: manualItems > 0 ? 'warn' : 'ok' },
    { label: 'blocked', value: plan.summary.blockedItems, status: plan.summary.blockedItems > 0 ? 'blocked' : 'ok' },
  ]
  if (plan.summary.planErrors > 0) {
    items.push({ label: plural(plan.summary.planErrors, 'plan error'), value: plan.summary.planErrors, status: 'fail' })
  }
  return items
}

function applySummary(report: DoctorRepairApplyData): SummaryItem[] {
  return [
    { label: 'applied', value: report.summary.applied, status: report.summary.applied > 0 ? 'applied' : 'ok' },
    { label: 'skipped', value: report.summary.skipped, status: report.summary.skipped > 0 ? 'skip' : 'ok' },
    { label: 'failed', value: report.summary.failed, status: report.summary.failed > 0 ? 'fail' : 'ok' },
    {
      label: 'verification',
      value: report.summary.verificationErrors + report.summary.verificationWarnings,
      status: report.summary.verificationErrors > 0 ? 'fail' : report.summary.verificationWarnings > 0 ? 'warn' : 'ok',
    },
  ]
}

function resultRows(results: DoctorRepairApplyData['applied'] | DoctorRepairApplyData['skipped']): FindingRow[] {
  return results.map(result => ({
    status: statusForDiagnostic(result.status),
    label: result.checkId || result.id,
    message: result.message,
    detail: changesDetail(result.changes),
  }))
}

function requestField(report: DoctorDelegateReportData, key: string): string | undefined {
  const value = report.request[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function DoctorRepairPlan({ plan, color = true }: {
  plan: DoctorRepairPlanData
  color?: boolean
}) {
  const safeItems = plan.items.filter(item => item.safety === 'safe')
  const manualItems = plan.items.filter(item => item.safety !== 'safe')

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Doctor repair plan" subtitle="Preview only; no changes have been applied" color={color} />
      <SummaryStrip items={repairPlanSummary(plan)} color={color} />
      {safeItems.length > 0 ? (
        <Section title="Safe deterministic repairs" color={color}>
          <FindingRows rows={itemRows(safeItems)} color={color} />
        </Section>
      ) : (
        <Section title="Safe deterministic repairs" color={color}>
          <FindingRows rows={[{ status: 'ok', label: 'repairs', message: 'No deterministic repairs available.' }]} color={color} />
        </Section>
      )}
      {manualItems.length > 0 ? (
        <Section title="Manual follow-up" color={color}>
          <FindingRows rows={itemRows(manualItems)} color={color} />
        </Section>
      ) : null}
      {plan.errors.length > 0 ? (
        <Section title="Plan errors" color={color}>
          <FindingRows rows={errorRows(plan.errors)} color={color} />
        </Section>
      ) : null}
    </Box>
  )
}

export function DoctorRepairApplyReport({ report, color = true, showBrand }: {
  report: DoctorRepairApplyData
  color?: boolean
  showBrand?: boolean
}) {
  return (
    <Box flexDirection="column">
      <ScreenHeader title="Doctor repair results" subtitle="Safe deterministic repairs applied" color={color} showBrand={showBrand} />
      <SummaryStrip items={applySummary(report)} color={color} />
      {report.applied.length > 0 ? (
        <Section title="Applied" color={color}>
          <FindingRows rows={resultRows(report.applied)} color={color} />
        </Section>
      ) : null}
      {report.skipped.length > 0 ? (
        <Section title="Skipped" color={color}>
          <FindingRows rows={resultRows(report.skipped)} color={color} />
        </Section>
      ) : null}
      {report.verification.length > 0 ? (
        <Section title="Verification" color={color}>
          <FindingRows rows={diagnosticRows(report.verification)} color={color} />
        </Section>
      ) : null}
      {report.errors.length > 0 ? (
        <Section title="Errors" color={color}>
          <FindingRows rows={errorRows(report.errors)} color={color} />
        </Section>
      ) : null}
    </Box>
  )
}

export function DoctorDelegatePreview({ unresolved, color = true }: {
  unresolved: DoctorRepairDiagnostic[]
  color?: boolean
}) {
  return (
    <Box flexDirection="column">
      <ScreenHeader title="Doctor delegated repair preview" subtitle="Preview only; no task has been created" color={color} />
      <SummaryStrip items={[
        { label: 'unresolved', value: unresolved.length, status: unresolved.length > 0 ? 'warn' : 'ok' },
      ]} color={color} />
      <Section title="Unresolved findings" color={color}>
        <FindingRows
          color={color}
          rows={unresolved.length > 0
            ? diagnosticRows(unresolved)
            : [{ status: 'ok', label: 'delegate', message: 'No unresolved findings need delegated repair.' }]}
        />
      </Section>
    </Box>
  )
}

export function DoctorDelegateResult({ report, color = true, showBrand }: {
  report: DoctorDelegateReportData
  color?: boolean
  showBrand?: boolean
}) {
  if (report.status === 'no_unresolved') {
    return <DoctorDelegatePreview unresolved={[]} color={color} />
  }

  const requestId = requestField(report, 'id') ?? '(unknown)'
  const taskId = requestField(report, 'taskId')
  const agentId = requestField(report, 'agentId')

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Delegated doctor repair" subtitle="A board task was created for unresolved work" color={color} showBrand={showBrand} />
      <SummaryStrip items={[
        { label: 'request', value: requestId, status: 'sent' },
        ...(taskId ? [{ label: 'task', value: taskId, status: 'todo' as const }] : []),
        ...(agentId ? [{ label: 'agent', value: agentId }] : []),
      ]} color={color} />
      <Section title="Repair brief" color={color}>
        <FindingRows rows={diagnosticRows(report.unresolved)} color={color} />
      </Section>
      <NextActions
        color={color}
        actions={[
          taskId ? `Watch the board for ${taskId} moving from todo to in-progress.` : 'Watch the board for the delegated repair task.',
          `Run \`bakin doctor repair verify ${requestId}\` after the agent reports completion.`,
        ]}
      />
    </Box>
  )
}
