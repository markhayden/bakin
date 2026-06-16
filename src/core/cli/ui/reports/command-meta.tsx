import { Box, Text } from 'ink'
import { DataTable, FindingRows, ScreenHeader, Section, SummaryStrip } from '../tui'
import { valueText, plural, type DetailFieldRow } from './format'

export interface HelpCommandData {
  name?: unknown
  usage?: unknown
  summary?: unknown
}

export interface HelpGroupData {
  group: string
  commands: HelpCommandData[]
}

export interface HelpEnvData {
  bakinUrl?: unknown
}

export interface CommandIssueData {
  command?: unknown
  message?: unknown
  detail?: unknown
  usage?: unknown
  available?: unknown
  availableLabel?: unknown
}

export interface CommandFailureData {
  command?: unknown
  message?: unknown
  detail?: unknown
  code?: unknown
  next?: unknown
}

export interface VersionData {
  version?: unknown
}

interface HelpCommandRow {
  command: string
  summary: string
}

function helpCommandRows(commands: HelpCommandData[]): HelpCommandRow[] {
  return commands.map(command => ({
    command: valueText(command.usage, valueText(command.name, 'bakin')),
    summary: valueText(command.summary),
  }))
}

function helpCommandCount(groups: HelpGroupData[]): number {
  return groups.reduce((total, group) => total + group.commands.length, 0)
}

function HelpCommandTable({ rows }: { rows: HelpCommandRow[] }) {
  return (
    <Box flexDirection="column">
      <Box gap={2}>
        <Box width={58} flexShrink={0}>
          <Text bold>COMMAND</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text bold>SUMMARY</Text>
        </Box>
      </Box>
      {rows.map(row => (
        <Box key={row.command} gap={2}>
          <Box width={58} flexShrink={0}>
            <Text wrap="wrap">{row.command}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="wrap">{row.summary}</Text>
          </Box>
        </Box>
      ))}
      <Text> </Text>
    </Box>
  )
}

export function HelpReport({ groups, env = {}, error, errorDetail, color = true }: {
  groups: HelpGroupData[]
  env?: HelpEnvData
  error?: string
  errorDetail?: string
  color?: boolean
}) {
  const commandCount = helpCommandCount(groups)
  const groupCount = groups.length
  const envRows: DetailFieldRow[] = [
    { field: 'BAKIN_URL', value: `Base URL for the running server (default: ${valueText(env.bakinUrl, 'http://localhost:3737')})` },
    { field: 'BAKIN_HOME', value: 'Override for ~/.bakin' },
    { field: 'PORT', value: 'Port to bind when `start` launches (default: 3737)' },
  ]

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Help" subtitle="Command reference" meta={error ? 'unknown command' : undefined} color={color} />
      <SummaryStrip items={[
        { label: plural(commandCount, 'command'), value: commandCount, status: commandCount > 0 ? 'ok' : 'skip' },
        { label: plural(groupCount, 'group'), value: groupCount, status: groupCount > 0 ? 'ok' : 'skip' },
      ]} color={color} />
      {error ? (
        <Section title="Issue" color={color}>
          <FindingRows rows={[{
            status: 'fail',
            label: 'command',
            message: error,
            detail: errorDetail,
            next: 'Run `bakin --help` to see available commands.',
          }]} color={color} />
          <Text> </Text>
        </Section>
      ) : null}
      {groups.map(group => (
        <Section key={group.group} title={group.group} color={color}>
          <HelpCommandTable rows={helpCommandRows(group.commands)} />
        </Section>
      ))}
      <Section title="Environment" color={color}>
        <DataTable
          columns={[
            { key: 'field', header: 'NAME', width: 14, render: row => row.field },
            { key: 'value', header: 'VALUE', width: 52, grow: true, render: row => row.value },
          ]}
          rows={envRows}
        />
      </Section>
    </Box>
  )
}

export function CommandIssueReport({ issue, color = true }: {
  issue: CommandIssueData
  color?: boolean
}) {
  const command = valueText(issue.command, 'command')
  const message = valueText(issue.message, 'Invalid command invocation.')
  const detail = valueText(issue.detail, '')
  const usage = valueText(issue.usage, '')
  const available = Array.isArray(issue.available)
    ? issue.available.map(item => valueText(item)).filter(Boolean)
    : []
  const availableLabel = valueText(issue.availableLabel, 'commands')

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Command issue" subtitle="Invalid command invocation" meta={command} color={color} />
      <SummaryStrip items={[
        { label: 'issue', value: 1, status: 'fail' },
        { label: 'usage', value: usage ? 1 : 0, status: usage ? 'ready' : 'skip' },
        { label: 'available', value: available.length, status: available.length > 0 ? 'ok' : 'skip' },
      ]} color={color} />
      <Section title="Issue" color={color}>
        <FindingRows rows={[{
          status: 'fail',
          label: command,
          message,
          detail: detail || undefined,
        }]} color={color} />
        <Text> </Text>
      </Section>
      {usage ? (
        <Section title="Usage" color={color}>
          <FindingRows rows={[{
            status: 'ready',
            label: 'usage',
            message: usage,
          }]} color={color} />
          <Text> </Text>
        </Section>
      ) : null}
      {available.length > 0 ? (
        <Section title="Available" color={color}>
          <FindingRows rows={[{
            status: 'ok',
            label: availableLabel,
            message: available.join(' | '),
          }]} color={color} />
          <Text> </Text>
        </Section>
      ) : null}
    </Box>
  )
}

export function CommandFailureReport({ failure, color = true }: {
  failure: CommandFailureData
  color?: boolean
}) {
  const command = valueText(failure.command, 'command')
  const message = valueText(failure.message, 'Command failed.')
  const detail = valueText(failure.detail, '')
  const code = valueText(failure.code, 'COMMAND_FAILED')
  const next = valueText(failure.next, '')

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Command failed" subtitle={message} meta={command} color={color} />
      <SummaryStrip items={[
        { label: 'failure', value: 1, status: 'fail' },
        { label: 'code', value: code, status: 'fail' },
        { label: 'next', value: next ? 1 : 0, status: next ? 'ready' : 'skip' },
      ]} color={color} />
      <Section title="Problem" color={color}>
        <FindingRows rows={[{
          status: 'fail',
          label: command,
          message,
          detail: detail || `Code: ${code}`,
        }]} color={color} />
        <Text> </Text>
      </Section>
      {next ? (
        <Section title="Next" color={color}>
          <FindingRows rows={[{
            status: 'ready',
            label: 'next',
            message: next,
          }]} color={color} />
          <Text> </Text>
        </Section>
      ) : null}
    </Box>
  )
}

export function VersionReport({ data, color = true }: {
  data: VersionData
  color?: boolean
}) {
  const version = valueText(data.version, 'unknown')

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Version" subtitle="Installed Bakin CLI" meta={`v${version}`} color={color} />
      <SummaryStrip items={[
        { label: 'version', value: 1, status: 'ok' },
      ]} color={color} />
      <Section title="Details" color={color}>
        <FindingRows rows={[{
          status: 'ok',
          label: 'bakin',
          message: version,
        }]} color={color} />
        <Text> </Text>
      </Section>
    </Box>
  )
}
