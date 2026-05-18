import { Box } from 'ink'
import {
  DataTable,
  FindingRows,
  ScreenHeader,
  Section,
  StatusTable,
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

export interface WorkflowTemplateData {
  filename?: unknown
  name?: unknown
  description?: unknown
  stepCount?: unknown
}

export interface AgentPackageData {
  agentId?: unknown
  state?: unknown
  packageId?: unknown
}

export interface AgentLessonData {
  lessonId?: unknown
  title?: unknown
  tags?: unknown
  enabled?: unknown
}

export interface PackageData {
  id?: unknown
  kind?: unknown
  version?: unknown
  refCount?: unknown
  dependents?: unknown
}

interface TaskTableRow {
  status: TuiStatus
  column: string
  id: string
  title: string
  agent: string
}

interface AgentTableRow {
  status: TuiStatus
  id: string
  name: string
  state: string
  model: string
}

interface PluginTableRow {
  status: TuiStatus
  plugin: string
  routes: string
}

interface WorkflowTableRow {
  filename: string
  name: string
  description: string
  steps: string
}

interface AgentPackageTableRow {
  status: TuiStatus
  agent: string
  state: string
  package: string
}

interface AgentLessonTableRow {
  status: TuiStatus
  enabled: string
  lesson: string
  title: string
  tags: string
}

interface PackageTableRow {
  status: TuiStatus
  package: string
  kind: string
  version: string
  refs: string
  dependents: string
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

function listText(value: unknown, fallback = '-'): string {
  if (!Array.isArray(value)) return valueText(value, fallback)
  if (value.length === 0) return fallback
  return value.map(item => valueText(item)).join(', ')
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

function workflowTableRows(templates: WorkflowTemplateData[]): WorkflowTableRow[] {
  return templates.map(template => ({
    filename: valueText(template.filename),
    name: valueText(template.name, '(unnamed)'),
    description: valueText(template.description),
    steps: valueText(template.stepCount),
  }))
}

function packageStateStatus(state: string): TuiStatus {
  switch (state) {
    case 'managed':
    case 'adopted':
      return 'ok'
    case 'missing':
    case 'drifted':
      return 'warn'
    case 'blocked':
      return 'blocked'
    default:
      return 'skip'
  }
}

function agentPackageTableRows(agents: AgentPackageData[]): AgentPackageTableRow[] {
  return agents.map(agent => {
    const state = valueText(agent.state)
    return {
      status: packageStateStatus(state),
      agent: valueText(agent.agentId),
      state,
      package: valueText(agent.packageId),
    }
  })
}

function agentLessonTableRows(lessons: AgentLessonData[]): AgentLessonTableRow[] {
  return lessons.map(lesson => {
    const enabled = lesson.enabled === true
    return {
      status: enabled ? 'ok' : 'skip',
      enabled: enabled ? 'yes' : 'no',
      lesson: valueText(lesson.lessonId),
      title: valueText(lesson.title, '(untitled lesson)'),
      tags: listText(lesson.tags),
    }
  })
}

function packageTableRows(packages: PackageData[]): PackageTableRow[] {
  return packages.map(pkg => ({
    status: 'ok',
    package: valueText(pkg.id),
    kind: valueText(pkg.kind),
    version: valueText(pkg.version),
    refs: valueText(pkg.refCount, '0'),
    dependents: listText(pkg.dependents),
  }))
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

export function WorkflowsListReport({ templates, color = true }: {
  templates: WorkflowTemplateData[]
  color?: boolean
}) {
  const rows = workflowTableRows(templates)

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Workflows" subtitle="Available workflow definitions" color={color} />
      <SummaryStrip items={[
        { label: plural(rows.length, 'workflow'), value: rows.length, status: rows.length > 0 ? 'ok' : 'skip' },
      ]} color={color} />
      <Section title="Definitions" color={color}>
        {rows.length > 0 ? (
          <DataTable
            rows={rows}
            columns={[
              { key: 'filename', header: 'FILENAME', width: 18, render: row => row.filename },
              { key: 'name', header: 'NAME', width: 22, render: row => row.name },
              { key: 'description', header: 'DESCRIPTION', width: 46, grow: true, render: row => row.description },
              { key: 'steps', header: 'STEPS', width: 7, render: row => row.steps },
            ]}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No workflow definitions found.' }]} color={color} />
        )}
      </Section>
    </Box>
  )
}

export function AgentPackagesListReport({ agents, color = true }: {
  agents: AgentPackageData[]
  color?: boolean
}) {
  const rows = agentPackageTableRows(agents)
  const managed = rows.filter(row => row.state === 'managed').length
  const adopted = rows.filter(row => row.state === 'adopted').length

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Agent Packages" subtitle="Installed agent package state" color={color} />
      <SummaryStrip items={[
        { label: plural(rows.length, 'agent'), value: rows.length, status: rows.length > 0 ? 'ok' : 'skip' },
        { label: 'managed', value: managed, status: managed > 0 ? 'ok' : 'skip' },
        { label: 'adopted', value: adopted, status: adopted > 0 ? 'ready' : 'skip' },
      ]} color={color} />
      <Section title="Package state" color={color}>
        {rows.length > 0 ? (
          <StatusTable
            rows={rows}
            columns={[
              { key: 'agent', header: 'AGENT', width: 18, render: row => row.agent },
              { key: 'state', header: 'STATE', width: 12, render: row => row.state },
              { key: 'package', header: 'PACKAGE', width: 34, grow: true, render: row => row.package },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No agent package state found.' }]} color={color} />
        )}
      </Section>
    </Box>
  )
}

export function AgentLessonsListReport({ agentId, packageId, lessons, color = true }: {
  agentId: string
  packageId: string
  lessons: AgentLessonData[]
  color?: boolean
}) {
  const rows = agentLessonTableRows(lessons)
  const enabled = rows.filter(row => row.enabled === 'yes').length
  const disabled = rows.length - enabled

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Agent Lessons" subtitle={`Lesson toggles for ${agentId}`} meta={`package: ${packageId}`} color={color} />
      <SummaryStrip items={[
        { label: plural(rows.length, 'lesson'), value: rows.length, status: rows.length > 0 ? 'ok' : 'skip' },
        { label: 'enabled', value: enabled, status: enabled > 0 ? 'ok' : 'skip' },
        { label: 'disabled', value: disabled, status: disabled > 0 ? 'skip' : 'ok' },
      ]} color={color} />
      <Section title="Lessons" color={color}>
        {rows.length > 0 ? (
          <StatusTable
            rows={rows}
            columns={[
              { key: 'enabled', header: 'ENABLED', width: 8, render: row => row.enabled },
              { key: 'lesson', header: 'LESSON', width: 24, render: row => row.lesson },
              { key: 'title', header: 'TITLE', width: 34, grow: true, render: row => row.title },
              { key: 'tags', header: 'TAGS', width: 22, render: row => row.tags },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No lessons found for this agent package.' }]} color={color} />
        )}
      </Section>
    </Box>
  )
}

export function PackagesListReport({ packages, color = true }: {
  packages: PackageData[]
  color?: boolean
}) {
  const rows = packageTableRows(packages)
  const referenced = rows.filter(row => row.refs !== '0').length

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Packages" subtitle="Installed standalone packages" color={color} />
      <SummaryStrip items={[
        { label: plural(rows.length, 'package'), value: rows.length, status: rows.length > 0 ? 'ok' : 'skip' },
        { label: 'referenced', value: referenced, status: referenced > 0 ? 'ok' : 'skip' },
      ]} color={color} />
      <Section title="Installed packages" color={color}>
        {rows.length > 0 ? (
          <StatusTable
            rows={rows}
            columns={[
              { key: 'package', header: 'PACKAGE', width: 30, grow: true, render: row => row.package },
              { key: 'kind', header: 'KIND', width: 12, render: row => row.kind },
              { key: 'version', header: 'VERSION', width: 12, render: row => row.version },
              { key: 'refs', header: 'REFS', width: 6, render: row => row.refs },
              { key: 'dependents', header: 'DEPENDENTS', width: 24, render: row => row.dependents },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No packages installed.' }]} color={color} />
        )}
      </Section>
    </Box>
  )
}
