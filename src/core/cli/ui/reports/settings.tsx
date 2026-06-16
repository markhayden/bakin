import { Box, Text } from 'ink'
import { DataTable, FindingRows, ScreenHeader, Section, SummaryStrip, type FindingRow } from '../tui'
import type { TuiStatus } from '../style-tokens'
import { valueText, detailText, objectField, isPlainRecord, flattenDetailFields, pathRows, plural } from './format'

export type SettingsData = Record<string, unknown>

export interface SettingsActionData {
  action?: unknown
  key?: unknown
  value?: unknown
  result?: unknown
  message?: unknown
  detail?: unknown
}

export interface ApiRouteData {
  method?: unknown
  fullPath?: unknown
  pluginId?: unknown
  description?: unknown
}

interface ApiRouteTableRow {
  method: string
  path: string
  plugin: string
  description: string
}

function settingsActionPayload(action: SettingsActionData): Record<string, unknown> {
  return isPlainRecord(action.result) ? action.result : {}
}

function settingsActionStatus(action: SettingsActionData): TuiStatus {
  const result = settingsActionPayload(action)
  if (objectField(result, 'ok') === false || objectField(result, 'error')) return 'fail'
  return 'applied'
}

function settingsActionTarget(action: SettingsActionData): string {
  return valueText(action.key, 'settings')
}

function settingsActionMessage(action: SettingsActionData): string {
  const result = settingsActionPayload(action)
  const error = valueText(objectField(result, 'error'), '')
  const message = valueText(objectField(result, 'message'), '')
  const explicit = valueText(action.message, '')
  const actionName = valueText(action.action, 'updated')
  const target = settingsActionTarget(action)

  if (error) return error
  if (explicit) return explicit
  if (message) return message
  if (actionName === 'updated') return `Updated setting ${target}.`
  return `Updated ${target}.`
}

function settingsActionDetail(action: SettingsActionData): string {
  const detail = valueText(action.detail, '')
  const value = detailText(action.value, '')
  return [value ? `Value: ${value}` : '', detail].filter(Boolean).join('\n')
}

function settingsActionRows(action: SettingsActionData): FindingRow[] {
  return [{
    status: settingsActionStatus(action),
    label: settingsActionTarget(action),
    message: settingsActionMessage(action),
    detail: settingsActionDetail(action) || undefined,
  }]
}

function apiRouteTableRows(routes: ApiRouteData[]): ApiRouteTableRow[] {
  return routes.map(route => ({
    method: valueText(route.method),
    path: valueText(route.fullPath),
    plugin: valueText(route.pluginId),
    description: valueText(route.description, ''),
  }))
}

export function SettingsReport({ settings, color = true }: {
  settings: SettingsData
  color?: boolean
}) {
  const rows = flattenDetailFields(settings)
  const sections = Object.keys(settings).length

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Settings" subtitle="Runtime configuration snapshot" color={color} />
      <SummaryStrip items={[
        { label: plural(sections, 'section'), value: sections, status: sections > 0 ? 'ok' : 'skip' },
        { label: plural(rows.length, 'value'), value: rows.length, status: rows.length > 0 ? 'ok' : 'skip' },
      ]} color={color} />
      <Section title="Configuration" color={color}>
        {rows.length > 0 ? (
          <DataTable
            rows={rows}
            columns={[
              { key: 'field', header: 'FIELD', width: 34, render: row => row.field },
              { key: 'value', header: 'VALUE', width: 52, grow: true, render: row => row.value },
            ]}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No settings returned by the server.' }]} color={color} />
        )}
      </Section>
    </Box>
  )
}

export function SettingsActionReport({ action, color = true }: {
  action: SettingsActionData
  color?: boolean
}) {
  const actionName = valueText(action.action, 'updated')
  const target = settingsActionTarget(action)

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Settings action" subtitle="Configuration updated" meta={actionName} color={color} />
      <SummaryStrip items={[
        { label: 'action', value: actionName, status: settingsActionStatus(action) },
        { label: 'setting', value: target, status: 'ok' },
      ]} color={color} />
      <Section title="Result" color={color}>
        <FindingRows rows={settingsActionRows(action)} color={color} />
        <Text> </Text>
      </Section>
    </Box>
  )
}

export function PathsReport({ paths, isBakinHome, color = true }: {
  paths: Record<string, unknown>
  isBakinHome?: unknown
  color?: boolean
}) {
  const rows = pathRows(paths)
  const homeLabel = isBakinHome ? '~/.bakin' : './content'

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Paths" subtitle="Bakin content directories" meta={`home: ${homeLabel}`} color={color} />
      <SummaryStrip items={[
        { label: plural(rows.length, 'path'), value: rows.length, status: rows.length > 0 ? 'ok' : 'skip' },
        { label: isBakinHome ? 'bakin home' : 'legacy content', value: homeLabel, status: isBakinHome ? 'ok' : 'warn' },
      ]} color={color} />
      <Section title="Directories" color={color}>
        {rows.length > 0 ? (
          <DataTable
            rows={rows}
            columns={[
              { key: 'field', header: 'KEY', width: 18, render: row => row.field },
              { key: 'value', header: 'PATH', width: 64, grow: true, render: row => row.value },
            ]}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No paths returned by the server.' }]} color={color} />
        )}
      </Section>
    </Box>
  )
}

export function DocsReport({ routes, color = true }: {
  routes: ApiRouteData[]
  color?: boolean
}) {
  const rows = apiRouteTableRows(routes)
  const pluginCount = new Set(rows.map(row => row.plugin).filter(plugin => plugin !== '-' && plugin !== 'core')).size

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Docs" subtitle="API routes from the running server" color={color} />
      <SummaryStrip items={[
        { label: plural(rows.length, 'route'), value: rows.length, status: rows.length > 0 ? 'ok' : 'skip' },
        { label: plural(pluginCount, 'plugin'), value: pluginCount, status: pluginCount > 0 ? 'ok' : 'skip' },
      ]} color={color} />
      <Section title="Routes" color={color}>
        {rows.length > 0 ? (
          <DataTable
            rows={rows}
            columns={[
              { key: 'method', header: 'METHOD', width: 8, render: row => row.method },
              { key: 'path', header: 'PATH', width: 42, grow: true, render: row => row.path },
              { key: 'plugin', header: 'PLUGIN', width: 16, render: row => row.plugin },
              { key: 'description', header: 'DESCRIPTION', width: 42, grow: true, render: row => row.description },
            ]}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No API routes returned by the server.' }]} color={color} />
        )}
      </Section>
    </Box>
  )
}
