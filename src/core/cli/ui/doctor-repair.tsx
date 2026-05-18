import { Box, Text } from 'ink'
import type { TuiStatus } from './style-tokens'
import {
  FindingRows,
  NextActions,
  ScreenHeader,
  Section,
  StatusTable,
  SummaryStrip,
  type FindingRow,
  type SummaryItem,
  type TableColumn,
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

export interface DoctorRepairRequestEventData {
  ts?: unknown
  type?: unknown
  message?: unknown
  data?: unknown
}

export interface DoctorRepairRequestData {
  id?: unknown
  kind?: unknown
  status?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  plan?: unknown
  unresolved?: unknown
  taskId?: unknown
  agentId?: unknown
  events?: unknown
}

export interface DoctorRepairVerificationData {
  request?: unknown
  remaining?: unknown
  verified?: unknown
}

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return count === 1 ? singular : pluralLabel
}

function valueText(value: unknown, fallback = '-'): string {
  if (typeof value === 'string') return value.length > 0 ? value : fallback
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function diagnosticList(value: unknown): DoctorRepairDiagnostic[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row) => {
    const item = objectValue(row)
    if (!item) return []
    return [{
      check: valueText(item.check, 'finding'),
      status: valueText(item.status, 'warn'),
      message: valueText(item.message, 'No message provided.'),
      autoFixable: typeof item.autoFixable === 'boolean' ? item.autoFixable : undefined,
    }]
  })
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

function statusForRequest(status: unknown): TuiStatus {
  switch (valueText(status, '').toLowerCase()) {
    case 'verified':
    case 'completed':
      return 'done'
    case 'sent':
      return 'sent'
    case 'planned':
      return 'todo'
    case 'failed':
      return 'fail'
    default:
      return 'run'
  }
}

function statusForEvent(type: unknown): TuiStatus {
  switch (valueText(type, '').toLowerCase()) {
    case 'verified':
      return 'done'
    case 'task-created':
    case 'dispatch-kicked':
      return 'sent'
    case 'failed':
      return 'fail'
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

function requestValue(request: Record<string, unknown>, key: string): string | undefined {
  const value = request[key]
  const text = valueText(value, '')
  return text.length > 0 ? text : undefined
}

function requestField(report: DoctorDelegateReportData, key: string): string | undefined {
  return requestValue(report.request, key)
}

type RequestTableRow = {
  status: TuiStatus
  request: string
  state: string
  task: string
  agent: string
}

const requestColumns: Array<TableColumn<RequestTableRow>> = [
  { key: 'request', header: 'REQUEST', width: 30, render: row => row.request },
  { key: 'state', header: 'STATE', width: 10, render: row => row.state },
  { key: 'task', header: 'TASK', width: 14, render: row => row.task },
  { key: 'agent', header: 'AGENT', width: 10, render: row => row.agent },
]

function requestTableRows(requests: DoctorRepairRequestData[]): RequestTableRow[] {
  return requests.map(request => ({
    status: statusForRequest(request.status),
    request: valueText(request.id, '(unknown)'),
    state: valueText(request.status, 'unknown'),
    task: valueText(request.taskId),
    agent: valueText(request.agentId),
  }))
}

function requestSummary(requests: DoctorRepairRequestData[]): SummaryItem[] {
  const active = requests.filter(request => !['verified', 'completed', 'failed'].includes(valueText(request.status, '').toLowerCase())).length
  const activeStatus = requests.some(request => valueText(request.status, '').toLowerCase() === 'sent') ? 'sent' : 'todo'
  const verified = requests.filter(request => ['verified', 'completed'].includes(valueText(request.status, '').toLowerCase())).length
  const failed = requests.filter(request => valueText(request.status, '').toLowerCase() === 'failed').length
  return [
    { label: plural(requests.length, 'request'), value: requests.length, status: requests.length > 0 ? 'ok' : 'skip' },
    { label: 'active', value: active, status: active > 0 ? activeStatus : 'ok' },
    { label: 'verified', value: verified, status: verified > 0 ? 'done' : 'ok' },
    ...(failed > 0 ? [{ label: 'failed', value: failed, status: 'fail' as const }] : []),
  ]
}

function requestDetailSummary(request: DoctorRepairRequestData): SummaryItem[] {
  const taskId = valueText(request.taskId, '')
  const agentId = valueText(request.agentId, '')
  return [
    { label: 'request', value: valueText(request.id, '(unknown)'), status: statusForRequest(request.status) },
    ...(taskId ? [{ label: 'task', value: taskId, status: 'todo' as const }] : []),
    ...(agentId ? [{ label: 'agent', value: agentId }] : []),
  ]
}

function requestDetailRows(request: DoctorRepairRequestData): FindingRow[] {
  return [
    { status: statusForRequest(request.status), label: 'status', message: valueText(request.status, 'unknown') },
    { status: 'todo', label: 'task', message: valueText(request.taskId) },
    { status: 'sent', label: 'agent', message: valueText(request.agentId) },
    { status: 'run', label: 'created', message: valueText(request.createdAt) },
    { status: 'run', label: 'updated', message: valueText(request.updatedAt) },
  ].filter(row => row.message !== '-') as FindingRow[]
}

function eventRows(events: unknown): FindingRow[] {
  if (!Array.isArray(events)) return []
  return events.flatMap((event) => {
    const item = objectValue(event)
    if (!item) return []
    return [{
      status: statusForEvent(item.type),
      label: valueText(item.type, 'event'),
      message: valueText(item.message, 'Event recorded.'),
      detail: valueText(item.ts, ''),
    }]
  })
}

function requestFromResult(result: DoctorRepairVerificationData): DoctorRepairRequestData | null {
  const request = objectValue(result.request)
  return request ? request as DoctorRepairRequestData : null
}

function verificationMessage(result: DoctorRepairVerificationData, remaining: DoctorRepairDiagnostic[]): string {
  if (result.verified === true) return 'Original delegated findings are resolved.'
  if (remaining.length === 1) return '1 original delegated finding still reproduces.'
  return `${remaining.length} original delegated findings still reproduce.`
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

export function DoctorRepairRequestsReport({ requests, color = true }: {
  requests: DoctorRepairRequestData[]
  color?: boolean
}) {
  return (
    <Box flexDirection="column">
      <ScreenHeader title="Doctor repair requests" subtitle="Delegated doctor repair tasks" color={color} />
      <SummaryStrip items={requestSummary(requests)} color={color} />
      <Section title="Requests" color={color}>
        {requests.length > 0 ? (
          <StatusTable columns={requestColumns} rows={requestTableRows(requests)} color={color} />
        ) : (
          <Box flexDirection="column">
            <FindingRows rows={[{ status: 'ok', label: 'requests', message: 'No doctor repair requests.' }]} color={color} />
            <Text> </Text>
          </Box>
        )}
      </Section>
    </Box>
  )
}

export function DoctorRepairRequestReport({ request, color = true }: {
  request: DoctorRepairRequestData
  color?: boolean
}) {
  const unresolved = diagnosticList(request.unresolved)
  const events = eventRows(request.events)

  return (
    <Box flexDirection="column">
      <ScreenHeader
        title="Doctor repair request"
        subtitle="Delegated repair task state"
        meta={valueText(request.id, '(unknown)')}
        color={color}
      />
      <SummaryStrip items={requestDetailSummary(request)} color={color} />
      <Section title="Request" color={color}>
        <FindingRows rows={requestDetailRows(request)} color={color} />
      </Section>
      <Section title="Unresolved findings" color={color}>
        <FindingRows
          rows={unresolved.length > 0
            ? diagnosticRows(unresolved)
            : [{ status: 'ok', label: 'findings', message: 'No unresolved findings are stored on this request.' }]}
          color={color}
        />
      </Section>
      {events.length > 0 ? (
        <Section title="Events" color={color}>
          <FindingRows rows={events} color={color} />
        </Section>
      ) : null}
    </Box>
  )
}

export function DoctorRepairVerifyReport({ requestId, result, color = true }: {
  requestId: string
  result: DoctorRepairVerificationData
  color?: boolean
}) {
  const request = requestFromResult(result)
  const remaining = diagnosticList(result.remaining)
  const resolved = result.verified === true
  const id = valueText(request?.id, requestId)

  return (
    <Box flexDirection="column">
      <ScreenHeader
        title="Doctor repair verification"
        subtitle={resolved ? 'Delegated repair no longer reproduces original findings' : 'Delegated repair still needs attention'}
        meta={id}
        color={color}
      />
      <SummaryStrip items={[
        { label: 'request', value: id, status: resolved ? 'done' : 'warn' },
        { label: 'remaining', value: remaining.length, status: remaining.length > 0 ? 'warn' : 'ok' },
      ]} color={color} />
      <Section title="Result" color={color}>
        <FindingRows
          rows={[{
            status: resolved ? 'done' : 'warn',
            label: id,
            message: verificationMessage(result, remaining),
          }]}
          color={color}
        />
      </Section>
      {remaining.length > 0 ? (
        <Section title="Remaining findings" color={color}>
          <FindingRows rows={diagnosticRows(remaining)} color={color} />
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
