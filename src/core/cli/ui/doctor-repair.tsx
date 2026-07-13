import { Box, Text } from 'ink'
import type {
  HealthIncident,
  HealthRepairApplyResult,
  HealthRepairChange,
  HealthRepairPlan,
  HealthRepairPlanItem,
  HealthReport,
} from '@makinbakin/sdk/types'
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
import { plural } from './reports/format'

export type DoctorRepairPlanData = HealthRepairPlan

export interface DoctorRepairApplyData {
  planId: string
  basedOnReportId: string
  results: HealthRepairApplyResult[]
  affectedCheckIds: string[]
  verifiedReportId: string
  verifiedIncidentIds: string[]
  report: HealthReport
}

export interface DoctorRepairRequestEventData {
  ts?: unknown
  type?: unknown
  message?: unknown
  data?: unknown
}

export interface DoctorRepairRequestData {
  version?: unknown
  id?: unknown
  kind?: unknown
  status?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  plan?: unknown
  incidentIds?: unknown
  observationIds?: unknown
  taskId?: unknown
  agentId?: unknown
  events?: unknown
}

export interface DoctorDelegateReportData {
  status: 'confirmation_required' | 'sent' | 'no_unresolved'
  request: DoctorRepairRequestData
  incidents: HealthIncident[]
}

export interface DoctorRepairVerificationData {
  request?: unknown
  remainingIncidentIds?: unknown
  verified?: unknown
  reportId?: unknown
}

// Objects and arrays intentionally use the fallback instead of implicit
// String(value) rendering in the operator UI.
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

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function repairPlanItems(value: unknown): HealthRepairPlanItem[] {
  const plan = objectValue(value)
  if (!plan || !Array.isArray(plan.items)) return []
  return plan.items.filter((item): item is HealthRepairPlanItem => {
    const row = objectValue(item)
    return Boolean(
      row
      && typeof row.id === 'string'
      && typeof row.actionId === 'string'
      && typeof row.title === 'string'
      && typeof row.reason === 'string'
      && (row.safety === 'safe' || row.safety === 'manual' || row.safety === 'destructive')
      && Array.isArray(row.changes),
    )
  })
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

function statusForSafety(safety: HealthRepairPlanItem['safety']): TuiStatus {
  if (safety === 'safe') return 'ready'
  if (safety === 'manual') return 'warn'
  return 'blocked'
}

function statusForApply(status: HealthRepairApplyResult['status']): TuiStatus {
  if (status === 'applied') return 'applied'
  if (status === 'skipped') return 'skip'
  return 'fail'
}

function statusForIncident(incident: HealthIncident): TuiStatus {
  if (incident.disposition === 'action_required' || incident.status === 'error') return 'fail'
  if (incident.status === 'unknown' || incident.stale) return 'run'
  if (incident.disposition === 'advisory') return 'ok'
  return 'warn'
}

function changesDetail(changes: readonly HealthRepairChange[]): string | undefined {
  if (changes.length === 0) return undefined
  return changes
    .map(change => `${change.action} ${change.target}: ${change.description}`)
    .join('; ')
}

function itemRows(items: readonly HealthRepairPlanItem[]): FindingRow[] {
  return items.map((item) => {
    const reason = item.reason.replace(/[.!?]+$/, '')
    const changes = changesDetail(item.changes)
    return {
      status: statusForSafety(item.safety),
      label: item.actionId,
      message: item.title,
      detail: changes ? `Reason: ${reason}. Change: ${changes}` : `Reason: ${item.reason}`,
    }
  })
}

function incidentRows(incidents: readonly HealthIncident[]): FindingRow[] {
  return incidents.map(incident => ({
    status: statusForIncident(incident),
    label: incident.id,
    message: incident.title,
    detail: `ID: ${incident.id}. Impact: ${incident.impact}`,
  }))
}

function incidentIdRows(ids: readonly string[]): FindingRow[] {
  return ids.map(id => ({
    status: 'todo',
    label: id,
    message: `Stable Health incident: ${id}`,
  }))
}

function repairPlanSummary(plan: HealthRepairPlan): SummaryItem[] {
  const safe = plan.items.filter(item => item.safety === 'safe').length
  const manual = plan.items.filter(item => item.safety === 'manual').length
  const destructive = plan.items.filter(item => item.safety === 'destructive').length
  return [
    { label: 'safe', value: safe, status: safe > 0 ? 'ready' : 'ok' },
    { label: 'manual', value: manual, status: manual > 0 ? 'warn' : 'ok' },
    { label: 'destructive', value: destructive, status: destructive > 0 ? 'blocked' : 'ok' },
  ]
}

function applySummary(report: DoctorRepairApplyData): SummaryItem[] {
  const applied = report.results.filter(result => result.status === 'applied').length
  const skipped = report.results.filter(result => result.status === 'skipped').length
  const failed = report.results.filter(result => result.status === 'failed').length
  return [
    { label: 'applied', value: applied, status: applied > 0 ? 'applied' : 'ok' },
    { label: 'skipped', value: skipped, status: skipped > 0 ? 'skip' : 'ok' },
    { label: 'failed', value: failed, status: failed > 0 ? 'fail' : 'ok' },
    {
      label: 'remaining',
      value: report.verifiedIncidentIds.length,
      status: report.verifiedIncidentIds.length > 0 ? 'warn' : 'ok',
    },
  ]
}

function resultRows(results: readonly HealthRepairApplyResult[]): FindingRow[] {
  return results.map(result => ({
    status: statusForApply(result.status),
    label: result.actionId || result.itemId,
    message: result.message,
    detail: changesDetail(result.changes),
  }))
}

function verificationRows(report: DoctorRepairApplyData): FindingRow[] {
  if (report.verifiedIncidentIds.length === 0) {
    return [{
      status: 'done',
      label: report.verifiedReportId,
      message: 'Selected repair incidents no longer reproduce.',
    }]
  }
  const byId = new Map(report.report.incidents.map(incident => [incident.id, incident]))
  return report.verifiedIncidentIds.map((id) => {
    const incident = byId.get(id)
    return incident
      ? incidentRows([incident])[0]!
      : { status: 'warn', label: id, message: 'Incident still appears in the verification report.' }
  })
}

function requestValue(request: DoctorRepairRequestData, key: keyof DoctorRepairRequestData): string | undefined {
  const text = valueText(request[key], '')
  return text.length > 0 ? text : undefined
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

function requestTableRows(requests: readonly DoctorRepairRequestData[]): RequestTableRow[] {
  return requests.map(request => ({
    status: statusForRequest(request.status),
    request: valueText(request.id, '(unknown)'),
    state: valueText(request.status, 'unknown'),
    task: valueText(request.taskId),
    agent: valueText(request.agentId),
  }))
}

function requestSummary(requests: readonly DoctorRepairRequestData[]): SummaryItem[] {
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

function verificationMessage(result: DoctorRepairVerificationData, remaining: readonly string[]): string {
  if (result.verified === true) return 'Original delegated incidents are resolved.'
  if (remaining.length === 1) return '1 original delegated incident still reproduces.'
  return `${remaining.length} original delegated incidents still reproduce.`
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
      <Section title="Safe deterministic repairs" color={color}>
        <FindingRows
          rows={safeItems.length > 0
            ? itemRows(safeItems)
            : [{ status: 'ok', label: 'repairs', message: 'No deterministic repairs available.' }]}
          color={color}
        />
      </Section>
      {manualItems.length > 0 ? (
        <Section title="Manual follow-up" color={color}>
          <FindingRows rows={itemRows(manualItems)} color={color} />
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
  const applied = report.results.filter(result => result.status === 'applied')
  const skipped = report.results.filter(result => result.status === 'skipped')
  const failed = report.results.filter(result => result.status === 'failed')
  return (
    <Box flexDirection="column">
      <ScreenHeader title="Doctor repair results" subtitle="Selected safe repairs applied and verified" color={color} showBrand={showBrand} />
      <SummaryStrip items={applySummary(report)} color={color} />
      {applied.length > 0 ? (
        <Section title="Applied" color={color}>
          <FindingRows rows={resultRows(applied)} color={color} />
        </Section>
      ) : null}
      {skipped.length > 0 ? (
        <Section title="Skipped" color={color}>
          <FindingRows rows={resultRows(skipped)} color={color} />
        </Section>
      ) : null}
      {failed.length > 0 ? (
        <Section title="Failed" color={color}>
          <FindingRows rows={resultRows(failed)} color={color} />
        </Section>
      ) : null}
      <Section title="Verification" color={color}>
        <FindingRows rows={verificationRows(report)} color={color} />
      </Section>
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
  const incidentIds = stringList(request.incidentIds)
  const planItems = repairPlanItems(request.plan)
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
      <Section title="Incidents" color={color}>
        <FindingRows
          rows={incidentIds.length > 0
            ? incidentIdRows(incidentIds)
            : [{ status: 'ok', label: 'incidents', message: 'No incident IDs are stored on this request.' }]}
          color={color}
        />
      </Section>
      {planItems.length > 0 ? (
        <Section title="Planned actions" color={color}>
          <FindingRows rows={itemRows(planItems)} color={color} />
        </Section>
      ) : null}
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
  const remaining = stringList(result.remainingIncidentIds)
  const resolved = result.verified === true
  const id = valueText(request?.id, requestId)
  return (
    <Box flexDirection="column">
      <ScreenHeader
        title="Doctor repair verification"
        subtitle={resolved ? 'Delegated repair no longer reproduces original incidents' : 'Delegated repair still needs attention'}
        meta={id}
        color={color}
      />
      <SummaryStrip items={[
        { label: 'request', value: id, status: resolved ? 'done' : 'warn' },
        { label: 'remaining', value: remaining.length, status: remaining.length > 0 ? 'warn' : 'ok' },
      ]} color={color} />
      <Section title="Result" color={color}>
        <FindingRows rows={[{
          status: resolved ? 'done' : 'warn',
          label: id,
          message: verificationMessage(result, remaining),
        }]} color={color} />
      </Section>
      {remaining.length > 0 ? (
        <Section title="Remaining incidents" color={color}>
          <FindingRows rows={incidentIdRows(remaining)} color={color} />
        </Section>
      ) : null}
    </Box>
  )
}

export function DoctorDelegatePreview({ incidents, color = true }: {
  incidents: HealthIncident[]
  color?: boolean
}) {
  return (
    <Box flexDirection="column">
      <ScreenHeader title="Doctor delegated repair preview" subtitle="Preview only; no task has been created" color={color} />
      <SummaryStrip items={[
        { label: 'action required', value: incidents.length, status: incidents.length > 0 ? 'warn' : 'ok' },
      ]} color={color} />
      <Section title="Action-required incidents" color={color}>
        <FindingRows
          color={color}
          rows={incidents.length > 0
            ? incidentRows(incidents)
            : [{ status: 'ok', label: 'delegate', message: 'No action-required incidents need delegated repair.' }]}
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
    return <DoctorDelegatePreview incidents={[]} color={color} />
  }

  const requestId = requestValue(report.request, 'id') ?? '(unknown)'
  const taskId = requestValue(report.request, 'taskId')
  const agentId = requestValue(report.request, 'agentId')
  return (
    <Box flexDirection="column">
      <ScreenHeader title="Delegated doctor repair" subtitle="A board task was created for action-required incidents" color={color} showBrand={showBrand} />
      <SummaryStrip items={[
        { label: 'request', value: requestId, status: 'sent' },
        ...(taskId ? [{ label: 'task', value: taskId, status: 'todo' as const }] : []),
        ...(agentId ? [{ label: 'agent', value: agentId }] : []),
      ]} color={color} />
      <Section title="Repair brief" color={color}>
        <FindingRows rows={incidentRows(report.incidents)} color={color} />
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
