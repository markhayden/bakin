import { Box, Text } from 'ink'
import { DataTable, FindingRows, ScreenHeader, Section, StatusTable, SummaryStrip, type FindingRow, type SummaryItem } from '../tui'
import type { TuiStatus } from '../style-tokens'
import { valueText, plural, detailText, type DetailFieldRow } from './format'

export interface TaskRowData {
  id?: unknown
  title?: unknown
  agent?: unknown
}

export type TaskDetailData = Record<string, unknown>

export interface TaskActionData {
  action?: unknown
  taskId?: unknown
  title?: unknown
  agent?: unknown
  column?: unknown
  workflowId?: unknown
  message?: unknown
  detail?: unknown
  suggestedWorkflow?: unknown
}

export interface AgentTaskData {
  id?: unknown
  title?: unknown
  column?: unknown
}

interface TaskTableRow {
  status: TuiStatus
  column: string
  id: string
  title: string
  agent: string
}

interface AgentTaskTableRow {
  status: TuiStatus
  id: string
  title: string
  column: string
}

const TASK_COLUMN_ORDER = ['backlog', 'todo', 'blocked', 'inProgress', 'review', 'done', 'archived'] as const

function taskColumnStatus(column: string): TuiStatus {
  switch (column) {
    case 'blocked':
      return 'blocked'
    case 'inProgress':
      return 'run'
    case 'review':
      return 'ready'
    case 'done':
    case 'archived':
      return 'done'
    default:
      return 'todo'
  }
}

function orderedTaskColumns(columns: Record<string, TaskRowData[]>): Array<[string, TaskRowData[]]> {
  const known = TASK_COLUMN_ORDER
    .filter(column => Array.isArray(columns[column]))
    .map(column => [column, columns[column]] as [string, TaskRowData[]])
  const knownNames = new Set(TASK_COLUMN_ORDER)
  const unknown = Object.entries(columns)
    .filter(([column]) => !knownNames.has(column as typeof TASK_COLUMN_ORDER[number]))
    .filter(([, tasks]) => Array.isArray(tasks))
    .sort(([a], [b]) => a.localeCompare(b))

  return [...known, ...unknown]
}

function taskTableRows(columns: Record<string, TaskRowData[]>): TaskTableRow[] {
  return orderedTaskColumns(columns).flatMap(([column, tasks]) => (
    tasks.map(task => ({
      status: taskColumnStatus(column),
      column,
      id: valueText(task.id, '(no id)'),
      title: valueText(task.title, '(untitled task)'),
      agent: valueText(task.agent),
    }))
  ))
}

function agentTaskTableRows(tasks: AgentTaskData[]): AgentTaskTableRow[] {
  return tasks.map(task => {
    const column = valueText(task.column)
    return {
      status: taskColumnStatus(column),
      id: valueText(task.id, '(no id)'),
      title: valueText(task.title, '(untitled task)'),
      column,
    }
  })
}

function taskSummary(columns: Record<string, TaskRowData[]>): SummaryItem[] {
  const entries = orderedTaskColumns(columns)
  const total = entries.reduce((sum, [, tasks]) => sum + tasks.length, 0)
  const active = entries
    .filter(([column]) => ['todo', 'inProgress', 'review'].includes(column))
    .reduce((sum, [, tasks]) => sum + tasks.length, 0)
  const blocked = columns.blocked?.length ?? 0
  const done = (columns.done?.length ?? 0) + (columns.archived?.length ?? 0)

  return [
    { label: plural(total, 'task'), value: total, status: total > 0 ? 'todo' : 'skip' },
    { label: 'active', value: active, status: active > 0 ? 'run' : 'ok' },
    { label: 'blocked', value: blocked, status: blocked > 0 ? 'blocked' : 'ok' },
    { label: 'done', value: done, status: done > 0 ? 'done' : 'ok' },
  ]
}

function taskActionStatus(action: TaskActionData): TuiStatus {
  const name = valueText(action.action)
  if (name === 'blocked') return 'blocked'
  if (name === 'completed') return 'done'
  if (name === 'moved') return taskColumnStatus(valueText(action.column))
  return 'applied'
}

function taskActionMessage(action: TaskActionData): string {
  const name = valueText(action.action, 'updated')
  const taskId = valueText(action.taskId, 'task')
  const title = valueText(action.title, taskId)
  const column = valueText(action.column, '')
  const detail = valueText(action.detail, '')

  switch (name) {
    case 'created':
      return `Created task ${title}.`
    case 'moved':
      return `Moved task ${taskId}${column ? ` to ${column}` : ''}.`
    case 'logged':
      return `Logged progress on task ${taskId}.`
    case 'blocked':
      return `Blocked task ${taskId}.`
    case 'dependency':
      return `Added dependency for task ${taskId}.`
    case 'completed':
      return `Completed task ${taskId}.`
    default:
      return detail ? `Updated task ${taskId}.` : `Updated task ${title}.`
  }
}

function taskActionRows(action: TaskActionData) {
  const status = taskActionStatus(action)
  const taskId = valueText(action.taskId, '')
  const title = valueText(action.title, taskId || 'task')
  const detail = valueText(action.detail, '')
  const workflowId = valueText(action.workflowId, '')
  const suggestedWorkflow = valueText(action.suggestedWorkflow, '')
  const rows: FindingRow[] = [{
    status,
    label: taskId || title,
    message: valueText(action.message, taskActionMessage(action)),
    detail: detail || undefined,
  }]

  if (workflowId) {
    rows.push({
      status: 'ok',
      label: 'workflow',
      message: `Workflow ${workflowId} associated with this task.`,
      detail: undefined,
    })
  }
  if (suggestedWorkflow) {
    rows.push({
      status: 'warn',
      label: 'workflow',
      message: `Workflow ${suggestedWorkflow} matches this task but was not started.`,
      detail: undefined,
      next: `Re-run with --workflow=${suggestedWorkflow} or --no-workflow="<reason>".`,
    })
  }

  return rows
}

function taskDetailFields(task: TaskDetailData): DetailFieldRow[] {
  const primary = new Set(['id', 'title', 'agent', 'column'])
  return Object.entries(task)
    .filter(([key]) => !primary.has(key))
    .map(([field, value]) => ({ field, value: detailText(value) }))
}

export function TasksListReport({ columns, column, color = true }: {
  columns: Record<string, TaskRowData[]>
  column?: string
  color?: boolean
}) {
  const rows = taskTableRows(columns)

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Tasks" subtitle="Board snapshot" meta={column ? `column: ${column}` : undefined} color={color} />
      <SummaryStrip items={taskSummary(columns)} color={color} />
      <Section title={column ? `Column ${column}` : 'Board'} color={color}>
        {rows.length > 0 ? (
          <StatusTable
            rows={rows}
            columns={[
              { key: 'column', header: 'COLUMN', width: 12, render: row => row.column },
              { key: 'id', header: 'ID', width: 16, render: row => row.id },
              { key: 'title', header: 'TITLE', width: 40, grow: true, render: row => row.title },
              { key: 'agent', header: 'AGENT', width: 16, render: row => row.agent },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No tasks found.' }]} color={color} />
        )}
      </Section>
    </Box>
  )
}

export function TaskActionReport({ action, color = true }: {
  action: TaskActionData
  color?: boolean
}) {
  const actionName = valueText(action.action, 'updated')
  const taskId = valueText(action.taskId, '')
  const agent = valueText(action.agent, '')
  const column = valueText(action.column, '')
  const context = agent
    ? { label: 'agent', value: agent, status: 'ok' as TuiStatus }
    : column
      ? { label: 'column', value: column, status: taskColumnStatus(column) }
      : { label: 'target', value: taskId || valueText(action.title, '-'), status: taskId ? 'ok' as TuiStatus : 'skip' as TuiStatus }

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Task action" subtitle="Board task updated" meta={actionName} color={color} />
      <SummaryStrip items={[
        { label: 'action', value: actionName, status: taskActionStatus(action) },
        { label: 'task', value: taskId || '-', status: taskId ? 'ok' : 'skip' },
        context,
      ]} color={color} />
      <Section title="Result" color={color}>
        <FindingRows rows={taskActionRows(action)} color={color} />
        <Text> </Text>
      </Section>
    </Box>
  )
}

export function AgentTasksReport({ agentId, tasks, color = true }: {
  agentId: string
  tasks: AgentTaskData[]
  color?: boolean
}) {
  const rows = agentTaskTableRows(tasks)
  const blocked = rows.filter(row => row.column === 'blocked').length
  const active = rows.filter(row => ['todo', 'inProgress', 'review'].includes(row.column)).length

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Agent Tasks" subtitle="Assigned task snapshot" meta={`agent: ${agentId}`} color={color} />
      <SummaryStrip items={[
        { label: plural(rows.length, 'task'), value: rows.length, status: rows.length > 0 ? 'todo' : 'skip' },
        { label: 'active', value: active, status: active > 0 ? 'run' : 'ok' },
        { label: 'blocked', value: blocked, status: blocked > 0 ? 'blocked' : 'ok' },
      ]} color={color} />
      <Section title="Tasks" color={color}>
        {rows.length > 0 ? (
          <StatusTable
            rows={rows}
            columns={[
              { key: 'id', header: 'ID', width: 16, render: row => row.id },
              { key: 'title', header: 'TITLE', width: 42, grow: true, render: row => row.title },
              { key: 'column', header: 'COLUMN', width: 14, render: row => row.column },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: `No tasks assigned to ${agentId}.` }]} color={color} />
        )}
      </Section>
    </Box>
  )
}

export function TaskDetailReport({ taskId, column, task, color = true }: {
  taskId: string
  column: string
  task: TaskDetailData
  color?: boolean
}) {
  const fields = taskDetailFields(task)
  const columnStatus = taskColumnStatus(column)
  const agent = valueText(task.agent, 'unassigned')

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Task Detail" subtitle="Board task snapshot" meta={`id: ${taskId}`} color={color} />
      <SummaryStrip items={[
        { label: 'column', value: column, status: columnStatus },
        { label: 'agent', value: agent, status: agent === 'unassigned' ? 'skip' : 'ok' },
      ]} color={color} />
      <Section title="Task" color={color}>
        <FindingRows rows={[
          { status: columnStatus, label: 'title', message: valueText(task.title, '(untitled task)') },
          { status: 'ready', label: 'id', message: valueText(task.id, taskId) },
          { status: agent === 'unassigned' ? 'skip' : 'ok', label: 'agent', message: agent },
          { status: columnStatus, label: 'column', message: column },
        ]} color={color} />
      </Section>
      {fields.length > 0 ? (
        <Section title="Fields" color={color}>
          <DataTable
            rows={fields}
            columns={[
              { key: 'field', header: 'FIELD', width: 18, render: row => row.field },
              { key: 'value', header: 'VALUE', width: 58, grow: true, render: row => row.value },
            ]}
          />
        </Section>
      ) : null}
    </Box>
  )
}
