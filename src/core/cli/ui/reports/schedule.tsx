import { Box, Text } from 'ink'
import { FindingRows, ScreenHeader, Section, StatusTable, SummaryStrip } from '../tui'
import type { TuiStatus } from '../style-tokens'
import { valueText, timestampText, plural } from './format'

export interface ScheduleJobData {
  id?: unknown
  displayName?: unknown
  agentId?: unknown
  humanSchedule?: unknown
  paused?: unknown
  enabled?: unknown
  isBakinJob?: unknown
}

export interface ScheduleRunData {
  runId?: unknown
  timestamp?: unknown
  status?: unknown
  taskId?: unknown
  error?: unknown
}

export interface ScheduleActionData {
  action?: unknown
  jobId?: unknown
  name?: unknown
  message?: unknown
  detail?: unknown
}

interface ScheduleJobTableRow {
  status: TuiStatus
  name: string
  agent: string
  schedule: string
  state: string
}

interface ScheduleRunTableRow {
  status: TuiStatus
  time: string
  state: string
  task: string
  error: string
}

function scheduleJobState(job: ScheduleJobData): string {
  if (job.paused === true) return 'paused'
  return job.enabled === false ? 'disabled' : 'active'
}

function scheduleJobStatus(state: string): TuiStatus {
  switch (state) {
    case 'active':
      return 'ok'
    case 'paused':
      return 'warn'
    case 'disabled':
      return 'skip'
    default:
      return 'skip'
  }
}

function scheduleJobTableRows(jobs: ScheduleJobData[]): ScheduleJobTableRow[] {
  return jobs.map(job => {
    const state = scheduleJobState(job)
    return {
      status: scheduleJobStatus(state),
      name: valueText(job.displayName, '(unnamed job)'),
      agent: valueText(job.agentId),
      schedule: valueText(job.humanSchedule),
      state,
    }
  })
}

function scheduleRunStatus(status: string): TuiStatus {
  switch (status) {
    case 'ok':
    case 'success':
    case 'completed':
      return 'ok'
    case 'error':
    case 'failed':
    case 'fail':
      return 'fail'
    case 'running':
      return 'run'
    case 'skipped':
    case 'cancelled':
    case 'canceled':
      return 'skip'
    default:
      return 'skip'
  }
}

function scheduleRunTableRows(runs: ScheduleRunData[]): ScheduleRunTableRow[] {
  return runs.map(run => {
    const state = valueText(run.status)
    return {
      status: scheduleRunStatus(state),
      time: timestampText(run.timestamp),
      state,
      task: valueText(run.taskId),
      error: valueText(run.error, ''),
    }
  })
}

function scheduleActionRows(action: ScheduleActionData) {
  const jobId = valueText(action.jobId, 'schedule')
  const name = valueText(action.name, '')
  const detail = valueText(action.detail, '')

  return [{
    status: 'applied' as const,
    label: jobId,
    message: valueText(action.message, name ? `Updated schedule ${name}.` : `Updated ${jobId}.`),
    detail: detail || undefined,
  }]
}

export function ScheduleListReport({ jobs, color = true }: {
  jobs: ScheduleJobData[]
  color?: boolean
}) {
  const rows = scheduleJobTableRows(jobs)
  const active = rows.filter(row => row.state === 'active').length
  const paused = rows.filter(row => row.state === 'paused').length
  const disabled = rows.filter(row => row.state === 'disabled').length

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Schedule" subtitle="Scheduled Bakin jobs" color={color} />
      <SummaryStrip items={[
        { label: plural(rows.length, 'job'), value: rows.length, status: rows.length > 0 ? 'ok' : 'skip' },
        { label: 'active', value: active, status: active > 0 ? 'ok' : 'skip' },
        { label: 'paused', value: paused, status: paused > 0 ? 'warn' : 'ok' },
        { label: 'disabled', value: disabled, status: disabled > 0 ? 'skip' : 'ok' },
      ]} color={color} />
      <Section title="Jobs" color={color}>
        {rows.length > 0 ? (
          <StatusTable
            rows={rows}
            columns={[
              { key: 'name', header: 'NAME', width: 28, grow: true, render: row => row.name },
              { key: 'agent', header: 'AGENT', width: 14, render: row => row.agent },
              { key: 'schedule', header: 'SCHEDULE', width: 28, render: row => row.schedule },
              { key: 'state', header: 'STATE', width: 10, render: row => row.state },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No scheduled jobs found.' }]} color={color} />
        )}
      </Section>
    </Box>
  )
}

export function ScheduleRunsReport({ jobId, runs, color = true }: {
  jobId: string
  runs: ScheduleRunData[]
  color?: boolean
}) {
  const rows = scheduleRunTableRows(runs)
  const failed = rows.filter(row => row.status === 'fail').length
  const withTasks = rows.filter(row => row.task !== '-').length

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Schedule Runs" subtitle="Run history" meta={`job: ${jobId}`} color={color} />
      <SummaryStrip items={[
        { label: plural(rows.length, 'run'), value: rows.length, status: rows.length > 0 ? 'ok' : 'skip' },
        { label: 'failed', value: failed, status: failed > 0 ? 'fail' : 'ok' },
        { label: 'tasks', value: withTasks, status: withTasks > 0 ? 'ok' : 'skip' },
      ]} color={color} />
      <Section title="Run history" color={color}>
        {rows.length > 0 ? (
          <StatusTable
            rows={rows}
            columns={[
              { key: 'time', header: 'TIME', width: 24, render: row => row.time },
              { key: 'state', header: 'STATE', width: 12, render: row => row.state },
              { key: 'task', header: 'TASK', width: 16, render: row => row.task },
              { key: 'error', header: 'ERROR', width: 40, grow: true, render: row => row.error },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: `No run history for ${jobId}.` }]} color={color} />
        )}
      </Section>
    </Box>
  )
}

export function ScheduleActionReport({ action, color = true }: {
  action: ScheduleActionData
  color?: boolean
}) {
  const actionName = valueText(action.action, 'updated')
  const jobId = valueText(action.jobId)

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Schedule action" subtitle="Scheduled job updated" meta={actionName} color={color} />
      <SummaryStrip items={[
        { label: 'action', value: actionName, status: 'applied' },
        { label: 'job', value: jobId || '-', status: jobId ? 'ok' : 'skip' },
      ]} color={color} />
      <Section title="Result" color={color}>
        <FindingRows rows={scheduleActionRows(action)} color={color} />
        <Text> </Text>
      </Section>
    </Box>
  )
}
