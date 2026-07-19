import { Box } from 'ink'
import type {
  HealthCheckState,
  HealthIncident,
  HealthObservation,
  HealthReport,
  HealthReportStatus,
  HealthResolution,
} from '@makinbakin/sdk/types'
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
import { plural } from './reports/format'

export type DoctorMode = 'offline' | 'full'

function reportStatus(status: HealthReportStatus): TuiStatus {
  switch (status) {
    case 'healthy':
      return 'ok'
    case 'degraded':
      return 'warn'
    case 'needs_attention':
      return 'fail'
    case 'unknown_stale':
      return 'run'
  }
}

function reportStatusLabel(status: HealthReportStatus): string {
  switch (status) {
    case 'healthy':
      return 'healthy'
    case 'degraded':
      return 'degraded'
    case 'needs_attention':
      return 'needs attention'
    case 'unknown_stale':
      return 'unknown / stale'
  }
}

function observationStatus(observation: HealthObservation): TuiStatus {
  if (observation.snapshot === 'last_known' && observation.status === 'healthy') return 'run'
  switch (observation.status) {
    case 'healthy':
      return 'ok'
    case 'warning':
      return 'warn'
    case 'error':
      return 'fail'
    case 'unknown':
      return 'run'
  }
}

function resolutionNext(resolution: HealthResolution): string | undefined {
  switch (resolution.type) {
    case 'repair':
      return 'Run `bakin doctor --fix` to preview the targeted repair.'
    case 'navigate':
      return `Open ${resolution.href}.`
    case 'instructions':
      return resolution.command
        ? `${resolution.steps.join(' ')} Command: ${resolution.command}`
        : resolution.steps.join(' ')
    case 'rerun':
      return 'Run `bakin doctor --full` to collect fresh evidence.'
  }
}

function observationRows(observations: readonly HealthObservation[]): FindingRow[] {
  return observations.map((observation) => ({
    status: observationStatus(observation),
    label: observation.checkId,
    message: observation.snapshot === 'last_known'
      ? `Last known: ${observation.summary}`
      : observation.summary,
    ...(observation.detail ? { detail: observation.detail } : {}),
    ...(observation.status === 'healthy'
      ? {}
      : { next: resolutionNext(observation.incident.resolution) }),
  }))
}

function executionRow(check: HealthCheckState): FindingRow | null {
  const execution = check.latestExecution
  if (execution.outcome === 'observed') return null
  if (execution.outcome === 'not_applicable') {
    return {
      status: 'skip',
      label: check.checkId,
      message: execution.reason ?? 'This check does not apply to the current configuration.',
    }
  }
  return {
    status: execution.outcome === 'invalid' ? 'fail' : 'run',
    label: check.checkId,
    message: execution.error?.message ?? `${check.checkName} did not produce current evidence.`,
    next: 'Run `bakin doctor --full` to collect fresh evidence.',
  }
}

function findingRows(report: HealthReport): FindingRow[] {
  const rows = observationRows(report.observations)
  const observedChecks = new Set(report.observations.map((observation) => observation.checkId))
  for (const check of report.checks) {
    if (observedChecks.has(check.checkId)) continue
    const row = executionRow(check)
    if (row) rows.push(row)
  }
  return rows.length > 0
    ? rows
    : [{ status: 'ok', label: 'health', message: 'No Health observations are registered.' }]
}

function summaryItems(report: HealthReport): SummaryItem[] {
  const { incidents, checks } = report.summary
  const items: SummaryItem[] = [
    { label: 'status', value: reportStatusLabel(report.overallStatus), status: reportStatus(report.overallStatus) },
  ]
  if (incidents.actionRequired > 0) {
    items.push({ label: 'action required', value: incidents.actionRequired, status: 'fail' })
  }
  if (incidents.watching > 0) {
    items.push({ label: 'watching', value: incidents.watching, status: incidents.unknown > 0 ? 'run' : 'warn' })
  }
  if (incidents.unknown > 0) {
    items.push({ label: 'unknown', value: incidents.unknown, status: 'run' })
  }
  if (incidents.advisory > 0) {
    items.push({ label: plural(incidents.advisory, 'advisory', 'advisories'), value: incidents.advisory })
  }
  items.push({ label: 'checks', value: checks.registered })
  return items
}

function subtitleForMode(mode?: DoctorMode): string {
  if (mode === 'full') return 'Fresh server-backed diagnostics'
  if (mode === 'offline') return 'Offline diagnostics from this machine'
  return 'Health diagnostics'
}

function hasUnknownEvidence(report: HealthReport): boolean {
  return report.overallStatus === 'unknown_stale'
    || report.incidents.some((incident) => incident.status === 'unknown' || incident.stale)
    || report.checks.some((check) => check.latestExecution.outcome === 'failed' || check.latestExecution.outcome === 'invalid')
}

function actionIncidents(report: HealthReport): HealthIncident[] {
  return report.incidents.filter((incident) => incident.effectiveDisposition === 'action_required')
}

function nextActions(report: HealthReport, mode?: DoctorMode): string[] {
  const actions: string[] = []
  if (hasUnknownEvidence(report)) {
    actions.push(mode === 'offline'
      ? 'Run `bakin start`, then `bakin doctor --full` to verify server-backed health.'
      : 'Run `bakin doctor --full` to collect fresh evidence for unknown or stale checks.')
  }

  const actionable = actionIncidents(report)
  if (actionable.some((incident) => incident.resolution.type === 'repair')) {
    actions.push('Run `bakin doctor --fix` to preview safe targeted repairs.')
  }
  if (actionable.some((incident) => incident.resolution.type !== 'repair')) {
    actions.push('Run `bakin doctor --delegate` to preview a repair task for action-required incidents.')
  }
  return actions
}

export function DoctorReport({ report, mode, color = true }: {
  report: HealthReport
  mode?: DoctorMode
  color?: boolean
}) {
  const actions = nextActions(report, mode)

  return (
    <Box flexDirection="column">
      <ScreenHeader
        title="Doctor"
        subtitle={subtitleForMode(mode)}
        meta={mode ? `mode: ${mode}` : undefined}
        color={color}
      />
      <SummaryStrip items={summaryItems(report)} color={color} />
      <Section title="Health findings" color={color}>
        <FindingRows rows={findingRows(report)} color={color} />
      </Section>
      {actions.length > 0 ? <NextActions actions={actions} color={color} /> : null}
    </Box>
  )
}
