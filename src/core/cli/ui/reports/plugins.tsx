import { Box, Text } from 'ink'
import { DataTable, FindingRows, ScreenHeader, Section, StatusTable, SummaryStrip, type FindingRow } from '../tui'
import type { TuiStatus } from '../style-tokens'
import { valueText, numberValue, listText, objectField, isPlainRecord, timestampText, bytesText, plural } from './format'

export interface PluginData {
  id?: unknown
  name?: unknown
  version?: unknown
  source?: unknown
  status?: unknown
  upgradeAvailable?: unknown
  staleHintDays?: unknown
  errorMessage?: unknown
}

export interface PluginActionData {
  action?: unknown
  pluginId?: unknown
  source?: unknown
  file?: unknown
  result?: unknown
  message?: unknown
  detail?: unknown
}

export interface PluginRestoreSnapshotData {
  timestamp?: unknown
  createdAt?: unknown
  filename?: unknown
  sizeBytes?: unknown
}

export interface PluginRestoreResultData {
  ok?: unknown
  message?: unknown
  snapshot?: unknown
  snapshotInfo?: PluginRestoreSnapshotData
  snapshots?: PluginRestoreSnapshotData[]
  skills?: unknown
  restored?: unknown
  activated?: unknown
}

interface PluginTableRow {
  status: TuiStatus
  plugin: string
  source: string
  version: string
  state: string
}

interface PluginRestoreSnapshotRow {
  timestamp: string
  created: string
  size: string
  filename: string
}

function pluginActionPayload(action: PluginActionData): Record<string, unknown> {
  return isPlainRecord(action.result) ? action.result : {}
}

function pluginActionStatus(action: PluginActionData): TuiStatus {
  const payload = pluginActionPayload(action)
  const failed = objectField(payload, 'ok') === false || objectField(payload, 'core') === true || Boolean(objectField(payload, 'error'))
  if (failed) return objectField(payload, 'awaitingConsent') === true ? 'ready' : 'fail'
  if (objectField(payload, 'awaitingConsent') === true) return 'ready'
  if (objectField(payload, 'noop') === true) return 'ok'
  if (valueText(action.action, '') === 'exported') return 'ok'
  if (valueText(action.action, '') === 'imported' && Array.isArray(objectField(payload, 'failed')) && (objectField(payload, 'failed') as unknown[]).length > 0) return 'fail'
  if (valueText(action.action, '') === 'removed' && !objectField(payload, 'snapshot')) return 'warn'
  return 'applied'
}

function pluginActionTarget(action: PluginActionData): string {
  const payload = pluginActionPayload(action)
  return valueText(
    objectField(payload, 'id'),
    valueText(action.pluginId, valueText(action.file, valueText(action.source, valueText(action.action, 'plugin')))),
  )
}

function pluginActionMessage(action: PluginActionData): string {
  const payload = pluginActionPayload(action)
  const actionName = valueText(action.action, 'updated')
  const target = pluginActionTarget(action)
  const explicit = valueText(action.message, '')
  const error = valueText(objectField(payload, 'error'), '')
  const message = valueText(objectField(payload, 'message'), '')
  const installed = Array.isArray(objectField(payload, 'installed')) ? (objectField(payload, 'installed') as unknown[]) : []
  const failed = Array.isArray(objectField(payload, 'failed')) ? (objectField(payload, 'failed') as unknown[]) : []
  const count = numberValue(objectField(payload, 'count'))
  const before = objectField(payload, 'before')
  const after = objectField(payload, 'after')
  const fromVersion = isPlainRecord(before) ? valueText(objectField(before, 'version'), '') : ''
  const toVersion = isPlainRecord(after) ? valueText(objectField(after, 'version'), '') : ''

  if (objectField(payload, 'core') === true) {
    const verb = actionName === 'upgraded' ? 'upgrade' : actionName === 'removed' ? 'remove' : actionName
    return `Refusing to ${verb} core plugin ${target}.`
  }
  if (error) return error
  if (explicit) return explicit
  if (message) return message
  if (objectField(payload, 'awaitingConsent') === true) {
    const nextAction = actionName === 'upgraded' ? 'upgrade' : 'install'
    return `Plugin ${target} requires permission consent before ${nextAction}.`
  }
  if (objectField(payload, 'noop') === true) return `Plugin ${target} is already up to date.`
  if (actionName === 'imported') {
    return failed.length > 0
      ? `Import failed after installing ${installed.length} plugin${installed.length === 1 ? '' : 's'}.`
      : `Imported ${installed.length} plugin${installed.length === 1 ? '' : 's'}.`
  }
  if (actionName === 'exported') return `Exported ${count} plugin${count === 1 ? '' : 's'} to ${target}.`
  if (actionName === 'upgraded') {
    const version = fromVersion || toVersion ? ` ${fromVersion || '?'} -> ${toVersion || '?'}` : ''
    return `Upgraded plugin ${target}${version}.`
  }
  if (actionName === 'scaffolded') return `Scaffolded plugin ${target}.`
  if (actionName === 'installed') return `Installed plugin ${target}.`
  if (actionName === 'removed') return `Removed plugin ${target}.`
  if (actionName === 'linked') return `Linked plugin ${target}.`
  if (actionName === 'unlinked') return `Unlinked plugin ${target}.`
  return `Updated plugin ${target}.`
}

function pluginPermissionsDetail(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return []
  return [`Permissions: ${value.length} requested`]
}

function pluginActionDetail(action: PluginActionData): string {
  const payload = pluginActionPayload(action)
  const actionName = valueText(action.action, '')
  const details = [valueText(action.detail, '')].filter(Boolean)
  const source = valueText(action.source, '')
  const file = valueText(action.file, '')
  const version = valueText(objectField(payload, 'version'), '')
  const runtimeVersion = valueText(objectField(payload, 'runtimeVersion'), '')
  const pluginDir = valueText(objectField(payload, 'pluginDir'), '')
  const linkedSource = valueText(objectField(payload, 'linkedSource'), '')
  const snapshot = valueText(objectField(payload, 'snapshot'), '')
  const root = valueText(objectField(payload, 'root'), '')
  const skills = objectField(payload, 'skills')
  const pluginAssets = objectField(payload, 'pluginAssets')
  const installed = Array.isArray(objectField(payload, 'installed')) ? (objectField(payload, 'installed') as unknown[]) : []
  const failed = Array.isArray(objectField(payload, 'failed')) ? (objectField(payload, 'failed') as unknown[]) : []
  const missing = listText(objectField(payload, 'skillsMissing'), '')
  const before = objectField(payload, 'before')
  const after = objectField(payload, 'after')
  const next = Array.isArray(objectField(payload, 'next')) ? (objectField(payload, 'next') as unknown[]) : []

  if (source) details.push(`Source: ${source}`)
  if (file && actionName !== 'exported') details.push(`File: ${file}`)
  if (version) details.push(`Version: ${version}`)
  if (runtimeVersion) details.push(`Runtime version: ${runtimeVersion}`)
  if (isPlainRecord(before) || isPlainRecord(after)) {
    const fromVersion = isPlainRecord(before) ? valueText(objectField(before, 'version'), '') : ''
    const toVersion = isPlainRecord(after) ? valueText(objectField(after, 'version'), '') : ''
    const fromCommit = isPlainRecord(before) ? valueText(objectField(before, 'commitSha'), '').slice(0, 12) : ''
    const toCommit = isPlainRecord(after) ? valueText(objectField(after, 'commitSha'), '').slice(0, 12) : ''
    if (fromVersion || toVersion) details.push(`Version: ${fromVersion || '-'} -> ${toVersion || '-'}`)
    if (fromCommit || toCommit) details.push(`Commit: ${fromCommit || '-'} -> ${toCommit || '-'}`)
  }
  if (objectField(payload, 'activated') === false) details.push('Activation deferred until next Bakin start.')
  if (objectField(payload, 'watching') === true) details.push('Dev hot reload is watching the linked source.')
  if (linkedSource) details.push(`Linked source: ${linkedSource}`)
  if (pluginDir) details.push(`Plugin dir: ${pluginDir}`)
  if (root) details.push(`Directory: ${root}`)
  if (snapshot) details.push(`Snapshot: ${snapshot}`)
  if (!snapshot && actionName === 'removed') details.push('Pre-removal snapshot was not created.')
  if (isPlainRecord(skills)) {
    const removed = valueText(objectField(skills, 'removed'), '')
    const kept = valueText(objectField(skills, 'kept'), '')
    if (removed || kept) details.push(`Runtime skills: ${removed || '0'} removed, ${kept || '0'} kept`)
  }
  if (missing) details.push(`Missing skills: ${missing}`)
  if (installed.length > 0) details.push(`Installed: ${installed.map(item => valueText(item)).join(', ')}`)
  if (isPlainRecord(pluginAssets)) {
    const applied = Array.isArray(objectField(pluginAssets, 'installed')) ? (objectField(pluginAssets, 'installed') as unknown[]).length : 0
    const skipped = Array.isArray(objectField(pluginAssets, 'skipped')) ? (objectField(pluginAssets, 'skipped') as unknown[]).length : 0
    if (applied > 0 || skipped > 0) details.push(`Runtime skills: ${applied} applied, ${skipped} skipped`)
  }
  if (failed.length > 0) {
    details.push(`Failed: ${failed.map(item => {
      if (!isPlainRecord(item)) return valueText(item)
      return `${valueText(objectField(item, 'id'))}: ${valueText(objectField(item, 'error'))}`
    }).join(', ')}`)
  }
  details.push(...pluginPermissionsDetail(objectField(payload, 'permissions')))
  if (next.length > 0) details.push(`Next: ${next.map(item => valueText(item)).join(' && ')}`)

  return details.filter(Boolean).join('\n')
}

function pluginActionRows(actions: PluginActionData[]): FindingRow[] {
  if (actions.length === 0) {
    return [{ status: 'skip', label: 'plugin', message: 'No plugin actions were applied.' }]
  }
  return actions.map(action => {
    const actionName = valueText(action.action, 'updated')
    const next = objectField(pluginActionPayload(action), 'awaitingConsent') === true
      ? `Re-run with --yes to accept permissions and ${actionName === 'upgraded' ? 'upgrade' : 'install'}.`
      : undefined
    return {
      status: pluginActionStatus(action),
      label: pluginActionTarget(action),
      message: pluginActionMessage(action),
      detail: pluginActionDetail(action) || undefined,
      next,
    }
  })
}

function pluginStatus(plugin: PluginData): TuiStatus {
  if (plugin.status === 'failed') return 'fail'
  if (plugin.upgradeAvailable === true) return 'warn'
  return 'ok'
}

function pluginState(plugin: PluginData): string {
  if (plugin.upgradeAvailable === true) return 'update available'
  const staleDays = numberValue(plugin.staleHintDays)
  if (staleDays > 0) return `stale ${staleDays}d`
  return valueText(plugin.status, 'active')
}

function pluginTableRows(plugins: PluginData[]): PluginTableRow[] {
  return plugins
    .map(plugin => ({
      status: pluginStatus(plugin),
      plugin: valueText(plugin.id),
      source: valueText(plugin.source),
      version: valueText(plugin.version),
      state: pluginState(plugin),
    }))
    .sort((a, b) => {
      const sourceCompare = a.source.localeCompare(b.source)
      return sourceCompare === 0 ? a.plugin.localeCompare(b.plugin) : sourceCompare
    })
}

function pluginRestoreSnapshotRows(snapshots: PluginRestoreSnapshotData[]): PluginRestoreSnapshotRow[] {
  return snapshots.map(snapshot => ({
    timestamp: valueText(snapshot.timestamp),
    created: timestampText(snapshot.createdAt),
    size: bytesText(snapshot.sizeBytes),
    filename: valueText(snapshot.filename),
  }))
}

function pluginRestoreSnapshotName(result: PluginRestoreResultData): string {
  return valueText(result.snapshotInfo?.filename ?? result.snapshot)
}

function pluginRestoreSkillsRestored(result: PluginRestoreResultData): number {
  return numberValue(objectField(result.skills, 'restored'))
}

function pluginRestoreResultRows(pluginId: string, result: PluginRestoreResultData) {
  const skillsRestored = pluginRestoreSkillsRestored(result)
  const rows = [
    {
      status: result.restored === false ? 'warn' as TuiStatus : 'ok' as TuiStatus,
      label: pluginId,
      message: valueText(result.message, `Restored plugin: ${pluginId}`),
    },
  ]

  rows.push({
    status: skillsRestored > 0 ? 'ok' : 'skip',
    label: 'runtime skills',
    message: `${skillsRestored} restored`,
  })
  rows.push(result.activated === false
    ? { status: 'warn', label: 'activation', message: 'Activation deferred until next server start.' }
    : { status: 'ok', label: 'activation', message: 'Plugin activated.' })

  return rows
}

export function PluginsListReport({ plugins, color = true }: {
  plugins: PluginData[]
  color?: boolean
}) {
  const rows = pluginTableRows(plugins)
  const core = rows.filter(row => row.source === 'core').length
  const external = rows.filter(row => row.source !== 'core').length
  const failed = rows.filter(row => row.status === 'fail').length

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Plugins" subtitle="Installed plugin packages" color={color} />
      <SummaryStrip items={[
        { label: plural(rows.length, 'plugin'), value: rows.length, status: rows.length > 0 ? 'ok' : 'skip' },
        { label: 'core', value: core, status: core > 0 ? 'ok' : 'skip' },
        { label: 'external', value: external, status: external > 0 ? 'ready' : 'skip' },
        { label: 'failed', value: failed, status: failed > 0 ? 'fail' : 'ok' },
      ]} color={color} />
      <Section title="Installed plugins" color={color}>
        {rows.length > 0 ? (
          <StatusTable
            rows={rows}
            columns={[
              { key: 'plugin', header: 'PLUGIN', width: 20, grow: true, render: row => row.plugin },
              { key: 'source', header: 'SOURCE', width: 10, render: row => row.source },
              { key: 'version', header: 'VERSION', width: 10, render: row => row.version },
              { key: 'state', header: 'STATE', width: 18, render: row => row.state },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No plugins found.' }]} color={color} />
        )}
      </Section>
    </Box>
  )
}

export function PluginActionReport({ actions, color = true }: {
  actions: PluginActionData[]
  color?: boolean
}) {
  const applied = actions.filter(action => ['applied', 'ok'].includes(pluginActionStatus(action))).length
  const attention = actions.filter(action => ['ready', 'warn'].includes(pluginActionStatus(action))).length
  const failed = actions.filter(action => pluginActionStatus(action) === 'fail').length
  const meta = actions.length === 1 ? valueText(actions[0]?.action, 'updated') : `${actions.length} actions`
  const overallStatus: TuiStatus = failed > 0 ? 'fail' : attention > 0 ? 'ready' : actions.length > 0 ? 'applied' : 'skip'

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Plugin action" subtitle="Plugin state updated" meta={meta} color={color} />
      <SummaryStrip items={[
        { label: plural(actions.length, 'action'), value: actions.length, status: overallStatus },
        { label: 'applied', value: applied, status: applied > 0 ? 'applied' : 'skip' },
        { label: 'attention', value: attention, status: attention > 0 ? 'ready' : 'ok' },
        { label: 'failed', value: failed, status: failed > 0 ? 'fail' : 'ok' },
      ]} color={color} />
      <Section title="Result" color={color}>
        <FindingRows rows={pluginActionRows(actions)} color={color} />
        <Text> </Text>
      </Section>
    </Box>
  )
}

export function PluginRestoreSnapshotsReport({ pluginId, snapshots, color = true }: {
  pluginId: string
  snapshots: PluginRestoreSnapshotData[]
  color?: boolean
}) {
  const rows = pluginRestoreSnapshotRows(snapshots)
  const latest = rows[0]?.timestamp ?? '-'

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Plugin Restore" subtitle="Available uninstall snapshots" meta={`plugin: ${pluginId}`} color={color} />
      <SummaryStrip items={[
        { label: plural(rows.length, 'snapshot'), value: rows.length, status: rows.length > 0 ? 'ready' : 'skip' },
        { label: 'latest', value: latest, status: rows.length > 0 ? 'ok' : 'skip' },
      ]} color={color} />
      <Section title="Snapshots" color={color}>
        {rows.length > 0 ? (
          <DataTable
            rows={rows}
            columns={[
              { key: 'timestamp', header: 'TIMESTAMP', width: 25, render: row => row.timestamp },
              { key: 'created', header: 'CREATED', width: 20, render: row => row.created },
              { key: 'size', header: 'SIZE', width: 9, render: row => row.size },
              { key: 'filename', header: 'FILENAME', width: 34, grow: true, render: row => row.filename },
            ]}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: `No uninstall snapshots found for plugin "${pluginId}".` }]} color={color} />
        )}
      </Section>
    </Box>
  )
}

export function PluginRestoreResultReport({ pluginId, result, color = true }: {
  pluginId: string
  result: PluginRestoreResultData
  color?: boolean
}) {
  const skillsRestored = pluginRestoreSkillsRestored(result)
  const snapshot = pluginRestoreSnapshotName(result)

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Plugin Restore" subtitle="Plugin restored from uninstall snapshot" meta={`plugin: ${pluginId}`} color={color} />
      <SummaryStrip items={[
        { label: 'restored', value: pluginId, status: result.restored === false ? 'warn' : 'ok' },
        { label: 'runtime skills', value: skillsRestored, status: skillsRestored > 0 ? 'ok' : 'skip' },
        { label: result.activated === false ? 'deferred' : 'activated', value: result.activated === false ? 'restart' : 'now', status: result.activated === false ? 'warn' : 'ok' },
      ]} color={color} />
      <Section title="Result" color={color}>
        <FindingRows rows={pluginRestoreResultRows(pluginId, result)} color={color} />
      </Section>
      {snapshot === '-' ? null : (
        <Section title="Snapshot" color={color}>
          <FindingRows rows={[{ status: 'ok', label: 'file', message: snapshot }]} color={color} />
        </Section>
      )}
    </Box>
  )
}
