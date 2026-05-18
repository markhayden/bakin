import { Box } from 'ink'
import {
  FindingRows,
  ScreenHeader,
  Section,
  SummaryStrip,
  type FindingRow,
  type SummaryItem,
} from './tui'
import type { TuiStatus } from './style-tokens'

export interface StatusDispatchData {
  intervalMin?: unknown
  lastRun?: unknown
  nextRun?: unknown
  secondsUntilNext?: unknown
  dispatchedCount?: unknown
}

export interface StatusRosterData {
  agentIds: string[]
  mainAgentId?: string | null
}

export interface TaskRowData {
  id?: unknown
  title?: unknown
  agent?: unknown
}

export interface AgentRowData {
  id: string
  name: string
  status: string
  model: string
}

export interface PluginRouteData {
  pluginId?: unknown
}

const TASK_COLUMN_ORDER = ['backlog', 'todo', 'blocked', 'inProgress', 'review', 'done', 'archived'] as const

function valueText(value: unknown, fallback = '-'): string {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0
}

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return count === 1 ? singular : pluralLabel
}

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

function taskRows(columns: Record<string, TaskRowData[]>): FindingRow[] {
  const rows = orderedTaskColumns(columns).flatMap(([column, tasks]) => (
    tasks.map(task => ({
      status: taskColumnStatus(column),
      label: valueText(task.id, '(no id)'),
      message: valueText(task.title, '(untitled task)'),
      detail: `Column: ${column}; Agent: ${valueText(task.agent)}`,
    }))
  ))

  if (rows.length === 0) {
    return [{ status: 'skip', label: 'empty', message: 'No tasks found.' }]
  }

  return rows
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

function agentStatus(status: string): TuiStatus {
  switch (status) {
    case 'working':
      return 'run'
    case 'online':
      return 'ok'
    case 'blocked':
      return 'blocked'
    default:
      return 'skip'
  }
}

function pluginRouteCounts(routes: PluginRouteData[]): Array<{ pluginId: string; routeCount: number }> {
  const counts = new Map<string, number>()
  for (const route of routes) {
    const pluginId = typeof route.pluginId === 'string' ? route.pluginId : ''
    if (!pluginId || pluginId === 'core') continue
    counts.set(pluginId, (counts.get(pluginId) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([pluginId, routeCount]) => ({ pluginId, routeCount }))
    .sort((a, b) => a.pluginId.localeCompare(b.pluginId))
}

export function StatusReport({ dispatch, roster, color = true }: {
  dispatch: StatusDispatchData
  roster: StatusRosterData
  color?: boolean
}) {
  const agentCount = roster.agentIds.length
  const dispatched = numberValue(dispatch.dispatchedCount)
  const interval = valueText(dispatch.intervalMin)
  const nextRun = valueText(dispatch.nextRun, 'not scheduled')

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Status" subtitle="Runtime dispatch snapshot" color={color} />
      <SummaryStrip items={[
        { label: plural(agentCount, 'agent'), value: agentCount, status: agentCount > 0 ? 'ok' : 'skip' },
        { label: 'tasks dispatched', value: dispatched, status: dispatched > 0 ? 'done' : 'ok' },
        { label: 'interval', value: `${interval}m` },
      ]} color={color} />
      <Section title="Dispatch" color={color}>
        <FindingRows rows={[
          { status: 'ok', label: 'interval', message: `${interval} minute${interval === '1' ? '' : 's'}` },
          { status: dispatch.lastRun ? 'ok' : 'skip', label: 'last run', message: valueText(dispatch.lastRun, 'never') },
          {
            status: 'ready',
            label: 'next run',
            message: nextRun,
            detail: dispatch.secondsUntilNext === undefined ? undefined : `${valueText(dispatch.secondsUntilNext)} seconds until next run`,
          },
        ]} color={color} />
      </Section>
      <Section title="Agents" color={color}>
        <FindingRows rows={[{
          status: agentCount > 0 ? 'ok' : 'skip',
          label: roster.mainAgentId ?? 'main',
          message: agentCount > 0 ? roster.agentIds.join(', ') : 'No agents reported by the runtime.',
        }]} color={color} />
      </Section>
    </Box>
  )
}

export function TasksListReport({ columns, column, color = true }: {
  columns: Record<string, TaskRowData[]>
  column?: string
  color?: boolean
}) {
  return (
    <Box flexDirection="column">
      <ScreenHeader title="Tasks" subtitle="Board snapshot" meta={column ? `column: ${column}` : undefined} color={color} />
      <SummaryStrip items={taskSummary(columns)} color={color} />
      <Section title={column ? `Column ${column}` : 'Board'} color={color}>
        <FindingRows rows={taskRows(columns)} color={color} />
      </Section>
    </Box>
  )
}

export function AgentsListReport({ agents, color = true }: {
  agents: AgentRowData[]
  color?: boolean
}) {
  const working = agents.filter(agent => agent.status === 'working').length
  const online = agents.filter(agent => agent.status === 'online').length

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Agents" subtitle="Runtime roster" color={color} />
      <SummaryStrip items={[
        { label: plural(agents.length, 'agent'), value: agents.length, status: agents.length > 0 ? 'ok' : 'skip' },
        { label: 'working', value: working, status: working > 0 ? 'run' : 'ok' },
        { label: 'online', value: online, status: online > 0 ? 'ok' : 'skip' },
      ]} color={color} />
      <Section title="Roster" color={color}>
        <FindingRows rows={agents.length > 0
          ? agents.map(agent => ({
            status: agentStatus(agent.status),
            label: agent.id,
            message: `${agent.name} (${agent.status})`,
            detail: `Model: ${agent.model}`,
          }))
          : [{ status: 'skip', label: 'empty', message: 'No agents reported by the runtime.' }]
        } color={color} />
      </Section>
    </Box>
  )
}

export function PluginsListReport({ routes, color = true }: {
  routes: PluginRouteData[]
  color?: boolean
}) {
  const plugins = pluginRouteCounts(routes)
  const routeTotal = plugins.reduce((sum, plugin) => sum + plugin.routeCount, 0)

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Plugins" subtitle="Installed plugin routes" color={color} />
      <SummaryStrip items={[
        { label: plural(plugins.length, 'plugin'), value: plugins.length, status: plugins.length > 0 ? 'ok' : 'skip' },
        { label: plural(routeTotal, 'route'), value: routeTotal, status: routeTotal > 0 ? 'ok' : 'skip' },
      ]} color={color} />
      <Section title="Installed plugins" color={color}>
        <FindingRows rows={plugins.length > 0
          ? plugins.map(plugin => ({
            status: 'ok',
            label: plugin.pluginId,
            message: `${plugin.routeCount} ${plural(plugin.routeCount, 'route')}`,
          }))
          : [{ status: 'skip', label: 'empty', message: 'No non-core plugins found.' }]
        } color={color} />
      </Section>
    </Box>
  )
}
