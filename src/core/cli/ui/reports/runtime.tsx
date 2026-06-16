import { Box, Text } from 'ink'
import { FindingRows, ScreenHeader, Section, StatusTable, SummaryStrip, type FindingRow } from '../tui'
import type { TuiStatus } from '../style-tokens'
import { valueText, numberValue, plural, listText, objectField, isPlainRecord, tuiStatusValue } from './format'

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

export interface RuntimeActionData {
  action?: unknown
  target?: unknown
  result?: unknown
  message?: unknown
  detail?: unknown
}

export interface AgentRowData {
  id: string
  name: string
  status: string
  model: string
}

export interface AgentProfileData {
  id?: unknown
  name?: unknown
  emoji?: unknown
  role?: unknown
  status?: unknown
  model?: unknown
  workspacePath?: unknown
  soul?: unknown
  identity?: unknown
  rules?: unknown
  tools?: unknown
  heartbeatMd?: unknown
  subagentPerms?: unknown
}

interface AgentTableRow {
  status: TuiStatus
  id: string
  name: string
  state: string
  model: string
}

function runtimeActionResult(action: RuntimeActionData): Record<string, unknown> {
  return isPlainRecord(action.result) ? action.result : {}
}

function runtimeActionStatus(action: RuntimeActionData): TuiStatus {
  const result = runtimeActionResult(action)
  if (objectField(result, 'ok') === false) return 'fail'
  const explicit = tuiStatusValue(objectField(result, 'status'))
  if (explicit) return explicit
  return 'sent'
}

function runtimeActionMessage(action: RuntimeActionData): string {
  const name = valueText(action.action, 'updated')
  const target = valueText(action.target, 'runtime')
  const result = runtimeActionResult(action)
  const error = valueText(objectField(result, 'error'), '')

  if (error) return error
  if (name === 'dispatch') return 'Triggered immediate task dispatch.'
  if (name === 'message') return `Sent message to ${target}.`
  return `Updated ${target}.`
}

function runtimeActionDetail(action: RuntimeActionData): string {
  const detail = valueText(action.detail, '')
  const result = runtimeActionResult(action)
  const reply = valueText(objectField(result, 'reply'), '')
  const ts = valueText(objectField(result, 'ts'), '')

  return [detail, reply, ts].filter(Boolean).join('\n')
}

function runtimeActionRows(action: RuntimeActionData): FindingRow[] {
  return [{
    status: runtimeActionStatus(action),
    label: valueText(action.target, valueText(action.action, 'runtime')),
    message: valueText(action.message, runtimeActionMessage(action)),
    detail: runtimeActionDetail(action) || undefined,
  }]
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

function contentPreview(value: unknown): string {
  const text = valueText(value, '')
  if (!text) return 'missing'
  return text.split('\n').map(line => line.trim()).find(Boolean) ?? 'present'
}

function contentStatus(value: unknown): TuiStatus {
  return valueText(value, '') ? 'ok' : 'skip'
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

export function RuntimeActionReport({ action, color = true }: {
  action: RuntimeActionData
  color?: boolean
}) {
  const actionName = valueText(action.action, 'updated')
  const target = valueText(action.target, 'runtime')

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Runtime action" subtitle="Runtime request accepted" meta={actionName} color={color} />
      <SummaryStrip items={[
        { label: 'action', value: actionName, status: runtimeActionStatus(action) },
        { label: 'target', value: target, status: 'ok' },
      ]} color={color} />
      <Section title="Result" color={color}>
        <FindingRows rows={runtimeActionRows(action)} color={color} />
        <Text> </Text>
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

export function AgentStatusReport({ agentId, profile, color = true }: {
  agentId: string
  profile: AgentProfileData
  color?: boolean
}) {
  const status = valueText(profile.status, 'profile')
  const permissions = Array.isArray(profile.subagentPerms) ? profile.subagentPerms.length : 0

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Agent Status" subtitle="Runtime profile snapshot" meta={`agent: ${agentId}`} color={color} />
      <SummaryStrip items={[
        { label: 'status', value: status, status: profile.status ? agentStatus(status) : 'ok' },
        { label: 'model', value: valueText(profile.model), status: profile.model ? 'ok' : 'skip' },
        { label: 'permissions', value: permissions, status: permissions > 0 ? 'ready' : 'skip' },
      ]} color={color} />
      <Section title="Profile" color={color}>
        <FindingRows rows={[
          { status: 'ready', label: 'id', message: valueText(profile.id, agentId) },
          { status: 'ok', label: 'name', message: `${valueText(profile.emoji, '').trim()} ${valueText(profile.name, '(unnamed agent)')}`.trim() },
          { status: profile.role ? 'ok' : 'skip', label: 'role', message: valueText(profile.role, '-') },
          { status: profile.model ? 'ok' : 'skip', label: 'model', message: valueText(profile.model, '-') },
          { status: profile.workspacePath ? 'ok' : 'skip', label: 'workspace', message: valueText(profile.workspacePath, '-') },
        ]} color={color} />
      </Section>
      <Section title="Workspace" color={color}>
        <FindingRows rows={[
          { status: contentStatus(profile.identity), label: 'identity', message: contentPreview(profile.identity) },
          { status: contentStatus(profile.soul), label: 'soul', message: contentPreview(profile.soul) },
          { status: contentStatus(profile.rules), label: 'rules', message: contentPreview(profile.rules) },
          { status: contentStatus(profile.tools), label: 'tools', message: contentPreview(profile.tools) },
          { status: contentStatus(profile.heartbeatMd), label: 'heartbeat', message: contentPreview(profile.heartbeatMd) },
          { status: permissions > 0 ? 'ready' : 'skip', label: 'subagents', message: listText(profile.subagentPerms, 'none') },
        ]} color={color} />
      </Section>
    </Box>
  )
}
