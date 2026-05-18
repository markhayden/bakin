import { Box, Text } from 'ink'
import {
  FindingRows,
  ScreenHeader,
  Section,
  StatusToken,
  SummaryStrip,
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

interface StatusTableColumn<TRow> {
  key: string
  header: string
  width: number
  grow?: boolean
  render: (row: TRow) => string
}

interface StatusTableRow {
  status: TuiStatus
}

interface TaskTableRow extends StatusTableRow {
  column: string
  id: string
  title: string
  agent: string
}

interface AgentTableRow extends StatusTableRow {
  id: string
  name: string
  state: string
  model: string
}

interface PluginTableRow extends StatusTableRow {
  plugin: string
  routes: string
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

function agentTableRows(agents: AgentRowData[]): AgentTableRow[] {
  return agents.map(agent => ({
    status: agentStatus(agent.status),
    id: agent.id,
    name: agent.name,
    state: agent.status,
    model: agent.model,
  }))
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

function pluginTableRows(routes: PluginRouteData[]): PluginTableRow[] {
  return pluginRouteCounts(routes).map(plugin => ({
    status: 'ok',
    plugin: plugin.pluginId,
    routes: String(plugin.routeCount),
  }))
}

function StatusTable<TRow extends StatusTableRow>({ rows, columns, color = true }: {
  rows: TRow[]
  columns: Array<StatusTableColumn<TRow>>
  color?: boolean
}) {
  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Box width={10} flexShrink={0}>
          <Text bold>STATUS</Text>
        </Box>
        {columns.map(column => (
          <Box
            key={column.key}
            width={column.width}
            flexGrow={column.grow ? 1 : 0}
            flexShrink={column.grow ? 1 : 0}
          >
            <Text bold wrap="truncate-end">{column.header}</Text>
          </Box>
        ))}
      </Box>
      {rows.map((row, rowIndex) => (
        <Box key={rowIndex} gap={1}>
          <Box width={10} flexShrink={0}>
            <StatusToken status={row.status} color={color} />
          </Box>
          {columns.map(column => (
            <Box
              key={column.key}
              width={column.width}
              flexGrow={column.grow ? 1 : 0}
              flexShrink={column.grow ? 1 : 0}
            >
              <Text wrap={column.grow ? 'wrap' : 'truncate-end'}>{column.render(row)}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
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

export function AgentsListReport({ agents, color = true }: {
  agents: AgentRowData[]
  color?: boolean
}) {
  const working = agents.filter(agent => agent.status === 'working').length
  const online = agents.filter(agent => agent.status === 'online').length
  const rows = agentTableRows(agents)

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Agents" subtitle="Runtime roster" color={color} />
      <SummaryStrip items={[
        { label: plural(agents.length, 'agent'), value: agents.length, status: agents.length > 0 ? 'ok' : 'skip' },
        { label: 'working', value: working, status: working > 0 ? 'run' : 'ok' },
        { label: 'online', value: online, status: online > 0 ? 'ok' : 'skip' },
      ]} color={color} />
      <Section title="Roster" color={color}>
        {rows.length > 0 ? (
          <StatusTable
            rows={rows}
            columns={[
              { key: 'id', header: 'ID', width: 18, render: row => row.id },
              { key: 'name', header: 'NAME', width: 26, grow: true, render: row => row.name },
              { key: 'state', header: 'STATE', width: 12, render: row => row.state },
              { key: 'model', header: 'MODEL', width: 20, render: row => row.model },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No agents reported by the runtime.' }]} color={color} />
        )}
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
  const rows = pluginTableRows(routes)

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Plugins" subtitle="Installed plugin routes" color={color} />
      <SummaryStrip items={[
        { label: plural(plugins.length, 'plugin'), value: plugins.length, status: plugins.length > 0 ? 'ok' : 'skip' },
        { label: plural(routeTotal, 'route'), value: routeTotal, status: routeTotal > 0 ? 'ok' : 'skip' },
      ]} color={color} />
      <Section title="Installed plugins" color={color}>
        {rows.length > 0 ? (
          <StatusTable
            rows={rows}
            columns={[
              { key: 'plugin', header: 'PLUGIN', width: 28, grow: true, render: row => row.plugin },
              { key: 'routes', header: 'ROUTES', width: 8, render: row => row.routes },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No non-core plugins found.' }]} color={color} />
        )}
      </Section>
    </Box>
  )
}
