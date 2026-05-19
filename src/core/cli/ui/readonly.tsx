import { Box, Text } from 'ink'
import {
  DataTable,
  FindingRows,
  ScreenHeader,
  Section,
  StatusTable,
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

export interface RuntimeActionData {
  action?: unknown
  target?: unknown
  result?: unknown
  message?: unknown
  detail?: unknown
}

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

export interface ApiRouteData {
  method?: unknown
  fullPath?: unknown
  pluginId?: unknown
  description?: unknown
}

export interface WorkflowTemplateData {
  filename?: unknown
  name?: unknown
  description?: unknown
  stepCount?: unknown
}

export interface WorkflowActionData {
  action?: unknown
  taskId?: unknown
  workflowId?: unknown
  stepId?: unknown
  result?: unknown
  message?: unknown
  detail?: unknown
}

export interface SearchResultData {
  id?: unknown
  key?: unknown
  table?: unknown
  score?: unknown
  _table?: unknown
  fields?: unknown
  document?: unknown
}

export interface SearchAggregationBucketData {
  value?: unknown
  count?: unknown
}

export type SearchAggregationsData = Record<string, SearchAggregationBucketData[]>

export interface SearchMetaData {
  query?: unknown
  total?: unknown
  took_ms?: unknown
  source?: unknown
}

export interface SearchStatsTableData {
  table?: unknown
  pluginId?: unknown
  stats?: unknown
  indexHealth?: unknown
  healthy?: unknown
}

export interface ReindexTableData {
  table?: unknown
  indexed?: unknown
  error?: unknown
  enrichment?: unknown
}

export interface ReindexResultData {
  ok?: unknown
  total?: unknown
  errors?: unknown
  enrichmentErrors?: unknown
  tables?: ReindexTableData[]
}

export type SettingsData = Record<string, unknown>

export interface SettingsActionData {
  action?: unknown
  key?: unknown
  value?: unknown
  result?: unknown
  message?: unknown
  detail?: unknown
}

export interface AgentRuleResultData {
  check?: unknown
  status?: unknown
  message?: unknown
  autoFixable?: unknown
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

export interface PackageActionData {
  action?: unknown
  scope?: unknown
  target?: unknown
  context?: unknown
  result?: unknown
  message?: unknown
  detail?: unknown
}

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

export interface TrashAssetData {
  filename?: unknown
  originalFilename?: unknown
  type?: unknown
  size?: unknown
  deletedAt?: unknown
  expiresAt?: unknown
  metadata?: unknown
}

export interface TrashActionData {
  action?: unknown
  target?: unknown
  count?: unknown
  message?: unknown
  detail?: unknown
}

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

interface AgentTableRow {
  status: TuiStatus
  id: string
  name: string
  state: string
  model: string
}

interface DetailFieldRow {
  field: string
  value: string
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

interface ApiRouteTableRow {
  method: string
  path: string
  plugin: string
  description: string
}

interface WorkflowTableRow {
  filename: string
  name: string
  description: string
  steps: string
}

interface SearchResultTableRow {
  title: string
  table: string
  score: string
  key: string
}

interface SearchStatsTableRow {
  status: TuiStatus
  table: string
  plugin: string
  docs: string
  health: string
}

interface ReindexTableRow {
  status: TuiStatus
  table: string
  docs: string
  enrichment: string
  issue: string
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

interface TrashAssetTableRow {
  status: TuiStatus
  filename: string
  type: string
  size: string
  deleted: string
  expires: string
  agent: string
}

interface HelpCommandRow {
  command: string
  summary: string
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

function detailText(value: unknown, fallback = '-'): string {
  if (value === null || value === undefined || value === '') return fallback
  if (Array.isArray(value)) return listText(value, fallback)
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function timestampText(value: unknown): string {
  const text = valueText(value)
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString()
}

function metadataAgent(value: unknown): string {
  if (!value || typeof value !== 'object') return 'unknown'
  const agent = (value as { agent?: unknown }).agent
  return valueText(agent, 'unknown')
}

function objectField(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined
  return (value as Record<string, unknown>)[key]
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function bytesText(value: unknown): string {
  const bytes = typeof value === 'number' && Number.isFinite(value) ? value : Number(value)
  if (!Number.isFinite(bytes)) return valueText(value)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function daysUntilText(value: unknown): string {
  const text = valueText(value)
  const diff = new Date(text).getTime() - Date.now()
  if (Number.isNaN(diff)) return text
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'expiring'
  return `${days}d`
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

function runtimeActionResult(action: RuntimeActionData): Record<string, unknown> {
  return isPlainRecord(action.result) ? action.result : {}
}

function tuiStatusValue(value: unknown): TuiStatus | undefined {
  switch (value) {
    case 'ok':
    case 'warn':
    case 'fail':
    case 'skip':
    case 'ready':
    case 'run':
    case 'blocked':
    case 'applied':
    case 'sent':
    case 'todo':
    case 'done':
      return value
    default:
      return undefined
  }
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

function packageActionEnvelope(action: PackageActionData): Record<string, unknown> {
  return isPlainRecord(action.result) ? action.result : {}
}

function packageActionPayload(action: PackageActionData): Record<string, unknown> {
  const envelope = packageActionEnvelope(action)
  const result = objectField(envelope, 'result')
  return isPlainRecord(result) ? result : envelope
}

function packageActionStatus(action: PackageActionData): TuiStatus {
  const envelope = packageActionEnvelope(action)
  const payload = packageActionPayload(action)
  if (objectField(envelope, 'ok') === false) return 'fail'
  if (objectField(payload, 'changed') === false) return 'ok'
  return 'applied'
}

function packageActionTarget(action: PackageActionData): string {
  const payload = packageActionPayload(action)
  return valueText(
    objectField(payload, 'packageId'),
    valueText(objectField(payload, 'lessonId'), valueText(action.target, valueText(action.scope, 'package'))),
  )
}

function packageActionMessage(action: PackageActionData): string {
  const payload = packageActionPayload(action)
  const envelope = packageActionEnvelope(action)
  const error = valueText(objectField(envelope, 'error'), valueText(objectField(payload, 'error'), ''))
  const explicit = valueText(action.message, '')
  const name = valueText(action.action, 'updated')
  const scope = valueText(action.scope, 'package')
  const target = packageActionTarget(action)
  const context = valueText(action.context, '')

  if (error) return error
  if (explicit) return explicit

  if (scope === 'lesson') {
    const lesson = valueText(objectField(payload, 'lessonId'), target)
    const nextState = objectField(payload, 'enabled') === false ? 'Disabled' : 'Enabled'
    const agent = context ? ` for ${context}` : ''
    return `${nextState} lesson ${lesson}${agent}.`
  }

  if (name === 'installed') return `Installed ${scope} ${target}.`
  if (name === 'removed') return `Removed ${scope} ${target}.`
  if (name === 'updated' && objectField(payload, 'changed') === false) return `Checked ${scope} ${target}; no changes.`
  if (name === 'updated') return `Updated ${scope} ${target}.`
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${scope} ${target}.`
}

function packageDependencyDetails(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return []
  return [`Dependencies: ${value.map((item) => {
    if (!isPlainRecord(item)) return valueText(item)
    const id = valueText(objectField(item, 'packageId'), '')
    const version = valueText(objectField(item, 'version'), '')
    return version ? `${id}@${version}` : id
  }).filter(Boolean).join(', ')}`]
}

function packageActionDetail(action: PackageActionData): string {
  const payload = packageActionPayload(action)
  const details = [valueText(action.detail, '')].filter(Boolean)
  const dependencies = packageDependencyDetails(objectField(payload, 'dependencies'))
  const removed = listText(objectField(payload, 'removed'), '')
  const kept = listText(objectField(payload, 'kept'), '')
  const skipped = Array.isArray(objectField(payload, 'skipped'))
    ? (objectField(payload, 'skipped') as unknown[]).length
    : 0
  const fromVersion = valueText(objectField(payload, 'fromVersion'), '')
  const toVersion = valueText(objectField(payload, 'toVersion'), '')
  const fromCommit = valueText(objectField(payload, 'fromCommitSha'), '')
  const toCommit = valueText(objectField(payload, 'toCommitSha'), '')
  const isLesson = valueText(action.scope, '') === 'lesson'

  if (objectField(payload, 'createdAgent') === true) details.push('Created runtime agent.')
  if (objectField(payload, 'adopted') === true) details.push('Adopted existing runtime agent.')
  details.push(...dependencies)
  if (skipped > 0) details.push(`${skipped} user-edited projection skipped.`)
  if (removed) details.push(`Removed: ${removed}`)
  if (kept) details.push(`Kept: ${kept}`)
  if (objectField(payload, 'deletedAgent') === true) details.push('Deleted runtime agent.')
  if (fromVersion || toVersion) details.push(`Version: ${fromVersion || '-'} -> ${toVersion || '-'}`)
  if (fromCommit || toCommit) details.push(`Commit: ${fromCommit.slice(0, 12) || '-'} -> ${toCommit.slice(0, 12) || '-'}`)
  if (objectField(payload, 'changed') === false && isLesson) {
    details.push('Lesson already matched the requested state.')
  } else if (objectField(payload, 'changed') === false) {
    details.push('No package changes were applied.')
  }

  return details.filter(Boolean).join('\n')
}

function packageActionRows(actions: PackageActionData[]): FindingRow[] {
  if (actions.length === 0) {
    return [{ status: 'skip', label: 'package', message: 'No package actions were applied.' }]
  }
  return actions.map(action => ({
    status: packageActionStatus(action),
    label: packageActionTarget(action),
    message: packageActionMessage(action),
    detail: packageActionDetail(action) || undefined,
  }))
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

function taskDetailFields(task: TaskDetailData): DetailFieldRow[] {
  const primary = new Set(['id', 'title', 'agent', 'column'])
  return Object.entries(task)
    .filter(([key]) => !primary.has(key))
    .map(([field, value]) => ({ field, value: detailText(value) }))
}

function flattenDetailFields(record: Record<string, unknown>, prefix = ''): DetailFieldRow[] {
  return Object.entries(record).flatMap(([key, value]) => {
    const field = prefix ? `${prefix}.${key}` : key
    if (isPlainRecord(value)) return flattenDetailFields(value, field)
    return [{ field, value: detailText(value) }]
  })
}

function pathRows(paths: unknown): DetailFieldRow[] {
  if (!isPlainRecord(paths)) return []
  return Object.entries(paths)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([field, value]) => ({ field, value: valueText(value) }))
}

function agentRuleStatus(value: unknown): TuiStatus {
  switch (value) {
    case 'ok':
      return 'ok'
    case 'fixed':
      return 'applied'
    case 'warn':
      return 'warn'
    case 'error':
      return 'fail'
    default:
      return 'skip'
  }
}

function agentRuleSummaryItems(results: AgentRuleResultData[]): SummaryItem[] {
  const ok = results.filter(result => result.status === 'ok').length
  const fixed = results.filter(result => result.status === 'fixed').length
  const warnings = results.filter(result => result.status === 'warn').length
  const errors = results.filter(result => result.status === 'error').length

  return [
    { label: 'up to date', value: ok, status: 'ok' },
    { label: 'fixed', value: fixed, status: fixed > 0 ? 'applied' : 'ok' },
    { label: 'warnings', value: warnings, status: warnings > 0 ? 'warn' : 'ok' },
    { label: 'errors', value: errors, status: errors > 0 ? 'fail' : 'ok' },
  ]
}

function agentRuleRows(results: AgentRuleResultData[], mode: 'check' | 'apply') {
  return results.map(result => {
    const status = agentRuleStatus(result.status)
    const autoFixable = Boolean(result.autoFixable)
    const next = mode === 'check' && autoFixable && (status === 'warn' || status === 'fail')
      ? 'Run `bakin agent-rules --apply` to write managed context.'
      : undefined

    return {
      status,
      label: valueText(result.check, 'check'),
      message: valueText(result.message, 'No result message returned.'),
      next,
    }
  })
}

function contentPreview(value: unknown): string {
  const text = valueText(value, '')
  if (!text) return 'missing'
  return text.split('\n').map(line => line.trim()).find(Boolean) ?? 'present'
}

function contentStatus(value: unknown): TuiStatus {
  return valueText(value, '') ? 'ok' : 'skip'
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

function apiRouteTableRows(routes: ApiRouteData[]): ApiRouteTableRow[] {
  return routes.map(route => ({
    method: valueText(route.method),
    path: valueText(route.fullPath),
    plugin: valueText(route.pluginId),
    description: valueText(route.description, ''),
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

function workflowResultRecord(action: WorkflowActionData): Record<string, unknown> {
  return isPlainRecord(action.result) ? action.result : {}
}

function workflowActionStatus(action: WorkflowActionData): TuiStatus {
  const name = valueText(action.action)
  const result = workflowResultRecord(action)
  const instance = objectField(result, 'instance')
  const status = valueText(
    objectField(instance, 'status')
      ?? objectField(result, 'status')
      ?? objectField(objectField(result, 'nextStep'), 'status'),
    '',
  )

  if (status === 'complete' || objectField(result, 'workflowComplete') === true) return 'done'
  if (status === 'failed' || status === 'cancelled') return 'fail'
  if (status === 'pending_approval') return 'ready'
  if (name === 'step') return 'run'
  return 'applied'
}

function workflowActionMessage(action: WorkflowActionData): string {
  const name = valueText(action.action, 'updated')
  const result = workflowResultRecord(action)
  const taskId = valueText(action.taskId, 'task')
  const workflowId = valueText(action.workflowId ?? objectField(objectField(result, 'instance'), 'workflowId'), 'workflow')
  const stepId = valueText(action.stepId ?? objectField(result, 'stepId'), 'step')
  const label = valueText(objectField(result, 'label'), stepId)
  const status = valueText(objectField(result, 'status'), '')

  switch (name) {
    case 'started':
      return `Started workflow ${workflowId} for task ${taskId}.`
    case 'step':
      if (status === 'complete') return `Workflow for task ${taskId} is complete.`
      if (status === 'pending_approval') return `Workflow step ${stepId} is waiting for approval.`
      return `Current workflow step ${stepId}: ${label}.`
    case 'submitted':
      return `Completed workflow step ${stepId}.`
    default:
      return `Updated workflow for task ${taskId}.`
  }
}

function workflowActionDetail(action: WorkflowActionData): string {
  const detail = valueText(action.detail, '')
  if (detail) return detail

  const name = valueText(action.action, 'updated')
  const result = workflowResultRecord(action)
  const instance = objectField(result, 'instance')
  const nextStep = objectField(result, 'nextStep')

  if (name === 'started') {
    const currentStep = valueText(objectField(instance, 'currentStepId'), '')
    const status = valueText(objectField(instance, 'status'), '')
    return [
      currentStep ? `current step: ${currentStep}` : '',
      status ? `status: ${status}` : '',
    ].filter(Boolean).join(', ')
  }

  if (name === 'step') {
    const agent = valueText(objectField(result, 'agent'), '')
    const type = valueText(objectField(result, 'type'), '')
    const status = valueText(objectField(result, 'status'), '')
    return [
      agent ? `agent: ${agent}` : '',
      type ? `type: ${type}` : '',
      status ? `status: ${status}` : '',
    ].filter(Boolean).join(', ')
  }

  if (name === 'submitted') {
    if (objectField(result, 'workflowComplete') === true) return 'Workflow complete.'
    if (isPlainRecord(nextStep)) {
      const stepId = valueText(nextStep.stepId, 'next')
      const label = valueText(nextStep.label, stepId)
      return `Next step ${stepId}: ${label}`
    }
  }

  return ''
}

function workflowActionRows(action: WorkflowActionData): FindingRow[] {
  const status = workflowActionStatus(action)
  const taskId = valueText(action.taskId, 'task')
  return [{
    status,
    label: taskId,
    message: valueText(action.message, workflowActionMessage(action)),
    detail: workflowActionDetail(action) || undefined,
  }]
}

function searchTableName(value: unknown): string {
  return valueText(value).replace(/^bakin_/, '')
}

function searchScoreText(value: unknown): string {
  const score = typeof value === 'number' && Number.isFinite(value) ? value : Number(value)
  return Number.isFinite(score) ? score.toFixed(3) : valueText(value, '?')
}

function searchResultTitle(result: SearchResultData): string {
  const document = result.fields ?? result.document
  const title = objectField(document, 'title') ?? objectField(document, 'name')
  return valueText(title, valueText(result.id ?? result.key, '(untitled result)'))
}

function searchResultTableRows(results: SearchResultData[]): SearchResultTableRow[] {
  return results.map(result => ({
    title: searchResultTitle(result),
    table: searchTableName(result.table ?? result._table),
    score: searchScoreText(result.score),
    key: valueText(result.id ?? result.key),
  }))
}

function searchFacetRows(aggregations: SearchAggregationsData = {}): Array<{ status: TuiStatus; label: string; message: string }> {
  return Object.entries(aggregations).map(([facet, values]) => ({
    status: values.length > 0 ? 'ok' : 'skip',
    label: facet,
    message: values.length > 0
      ? values.map(value => `${valueText(value.value)}(${valueText(value.count, '0')})`).join(', ')
      : 'none',
  }))
}

function searchIndexHealth(value: unknown): Array<{ name?: unknown; error?: unknown; walBacklog?: unknown; rebuilding?: unknown }> {
  return Array.isArray(value) ? value : []
}

function searchStatsDocCount(stats: unknown): string {
  return valueText(objectField(stats, 'num_docs'), '?')
}

function searchStatsStatus(table: SearchStatsTableData, enabled: boolean): TuiStatus {
  if (!enabled) return 'skip'
  const health = searchIndexHealth(table.indexHealth)
  if (table.healthy === false || health.some(index => valueText(index.error, '') !== '')) return 'fail'
  if (health.some(index => numberValue(index.walBacklog) > 0 || index.rebuilding === true)) return 'run'
  return 'ok'
}

function searchStatsHealth(table: SearchStatsTableData, enabled: boolean): string {
  if (!enabled) return 'disabled'
  const health = searchIndexHealth(table.indexHealth)
  if (table.healthy === false || health.some(index => valueText(index.error, '') !== '')) return 'unhealthy'
  if (health.some(index => numberValue(index.walBacklog) > 0 || index.rebuilding === true)) return 'enriching'
  return 'healthy'
}

function searchStatsTableRows(tables: SearchStatsTableData[], enabled: boolean): SearchStatsTableRow[] {
  return tables.map(table => ({
    status: searchStatsStatus(table, enabled),
    table: valueText(table.table),
    plugin: valueText(table.pluginId),
    docs: searchStatsDocCount(table.stats),
    health: searchStatsHealth(table, enabled),
  }))
}

function reindexEnrichmentText(value: unknown): string {
  if (!isPlainRecord(value)) return '-'
  const indexes = Array.isArray(value.indexes) ? value.indexes : []
  const issues = indexes.flatMap(index => {
    if (!isPlainRecord(index)) return []
    const name = valueText(index.name, 'index')
    const error = valueText(index.error, '')
    if (error) return [`${name}: ${error}`]
    const walBacklog = numberValue(index.walBacklog)
    if (walBacklog > 0) return [`${name}: ${walBacklog} wal`]
    return []
  })
  if (issues.length > 0) return issues.join(', ')
  return value.healthy === false ? 'unhealthy' : 'healthy'
}

function reindexTableRows(tables: ReindexTableData[]): ReindexTableRow[] {
  return tables.map(table => {
    const hasError = Boolean(table.error)
    const enrichmentUnhealthy = isPlainRecord(table.enrichment) && table.enrichment.healthy === false
    return {
      status: hasError ? 'fail' : enrichmentUnhealthy ? 'warn' : 'ok',
      table: valueText(table.table, '(unknown)'),
      docs: valueText(table.indexed, '0'),
      enrichment: reindexEnrichmentText(table.enrichment),
      issue: valueText(table.error),
    }
  })
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
  return packages
    .filter(pkg => valueText(pkg.kind) !== 'agent')
    .map(pkg => ({
      status: 'ok',
      package: valueText(pkg.id),
      kind: valueText(pkg.kind),
      version: valueText(pkg.version),
      refs: valueText(pkg.refCount, '0'),
      dependents: listText(pkg.dependents),
    }))
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

function trashAssetTableRows(assets: TrashAssetData[]): TrashAssetTableRow[] {
  return assets.map(asset => ({
    status: 'warn',
    filename: valueText(asset.originalFilename, valueText(asset.filename)),
    type: valueText(asset.type),
    size: bytesText(asset.size),
    deleted: timestampText(asset.deletedAt),
    expires: daysUntilText(asset.expiresAt),
    agent: metadataAgent(asset.metadata),
  }))
}

function trashActionStatus(action: TrashActionData): TuiStatus {
  const name = valueText(action.action)
  if (name === 'empty') return 'skip'
  return name === 'restored' || name === 'emptied' ? 'applied' : 'ok'
}

function trashActionRows(action: TrashActionData) {
  const status = trashActionStatus(action)
  const actionName = valueText(action.action, 'updated')
  const label = valueText(action.target, actionName)
  const count = valueText(action.count, '')
  const fallback = actionName === 'emptied'
    ? `Permanently deleted ${count || '0'} item${count === '1' ? '' : 's'}.`
    : actionName === 'empty'
      ? 'Trash is already empty.'
      : `Updated ${label}.`
  const detail = valueText(action.detail, '')

  return [{
    status,
    label,
    message: valueText(action.message, fallback),
    detail: detail || undefined,
  }]
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
            label: 'commands',
            message: available.join(' | '),
          }]} color={color} />
          <Text> </Text>
        </Section>
      ) : null}
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

export function AgentRulesReport({ results, mode, scope, color = true }: {
  results: AgentRuleResultData[]
  mode: 'check' | 'apply'
  scope: 'orchestrator' | 'all'
  color?: boolean
}) {
  const rows = agentRuleRows(results, mode)

  return (
    <Box flexDirection="column">
      <ScreenHeader
        title="Agent Rules"
        subtitle={mode === 'apply' ? 'Managed AGENTS.md context applied' : 'Managed AGENTS.md context checked'}
        meta={`scope: ${scope}`}
        color={color}
      />
      <SummaryStrip items={agentRuleSummaryItems(results)} color={color} />
      <Section title="Checks" color={color}>
        {rows.length > 0 ? (
          <FindingRows rows={rows} color={color} />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No agent-rules results returned.' }]} color={color} />
        )}
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

export function WorkflowActionReport({ action, color = true }: {
  action: WorkflowActionData
  color?: boolean
}) {
  const actionName = valueText(action.action, 'updated')
  const taskId = valueText(action.taskId, '')
  const workflowId = valueText(action.workflowId, '')
  const stepId = valueText(action.stepId, '')

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Workflow action" subtitle="Workflow state updated" meta={actionName} color={color} />
      <SummaryStrip items={[
        { label: 'action', value: actionName, status: workflowActionStatus(action) },
        { label: 'task', value: taskId || '-', status: taskId ? 'ok' : 'skip' },
        workflowId
          ? { label: 'workflow', value: workflowId, status: 'ok' }
          : { label: 'step', value: stepId || '-', status: stepId ? 'ready' : 'skip' },
      ]} color={color} />
      <Section title="Result" color={color}>
        <FindingRows rows={workflowActionRows(action)} color={color} />
        <Text> </Text>
      </Section>
    </Box>
  )
}

export function SearchResultsReport({ query, results, aggregations = {}, meta, color = true }: {
  query: string
  results: SearchResultData[]
  aggregations?: SearchAggregationsData
  meta?: SearchMetaData
  color?: boolean
}) {
  const rows = searchResultTableRows(results)
  const facets = searchFacetRows(aggregations)
  const total = numberValue(meta?.total ?? rows.length)
  const took = meta?.took_ms === undefined ? undefined : `${numberValue(meta.took_ms)}ms`
  const source = valueText(meta?.source, 'unknown')

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Search" subtitle={valueText(meta?.query, query)} meta={`source: ${source}`} color={color} />
      <SummaryStrip items={[
        { label: 'total', value: total, status: total > 0 ? 'ok' : 'skip' },
        { label: 'returned', value: rows.length, status: rows.length > 0 ? 'ready' : 'skip' },
        ...(took ? [{ label: 'elapsed', value: took }] : []),
      ]} color={color} />
      <Section title="Results" color={color}>
        {rows.length > 0 ? (
          <DataTable
            rows={rows}
            columns={[
              { key: 'title', header: 'TITLE', width: 42, grow: true, render: row => row.title },
              { key: 'table', header: 'TABLE', width: 16, render: row => row.table },
              { key: 'score', header: 'SCORE', width: 8, render: row => row.score },
              { key: 'key', header: 'KEY', width: 24, render: row => row.key },
            ]}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No results found.' }]} color={color} />
        )}
      </Section>
      {facets.length > 0 ? (
        <Section title="Facets" color={color}>
          <FindingRows rows={facets} color={color} />
        </Section>
      ) : null}
    </Box>
  )
}

export function SearchStatsReport({ enabled, tables, color = true }: {
  enabled: boolean
  tables: SearchStatsTableData[]
  color?: boolean
}) {
  const rows = searchStatsTableRows(tables, enabled)
  const unhealthy = rows.filter(row => row.status === 'fail').length
  const enriching = rows.filter(row => row.status === 'run').length

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Search Stats" subtitle="Search index health and document counts" color={color} />
      <SummaryStrip items={[
        { label: enabled ? 'enabled' : 'disabled', value: 'search', status: enabled ? 'ok' : 'skip' },
        { label: plural(rows.length, 'table'), value: rows.length, status: rows.length > 0 ? 'ok' : 'skip' },
        { label: 'unhealthy', value: unhealthy, status: unhealthy > 0 ? 'fail' : 'ok' },
        { label: 'enriching', value: enriching, status: enriching > 0 ? 'run' : 'ok' },
      ]} color={color} />
      <Section title="Tables" color={color}>
        {rows.length > 0 ? (
          <StatusTable
            rows={rows}
            columns={[
              { key: 'table', header: 'TABLE', width: 24, grow: true, render: row => row.table },
              { key: 'plugin', header: 'PLUGIN', width: 16, render: row => row.plugin },
              { key: 'docs', header: 'DOCS', width: 8, render: row => row.docs },
              { key: 'health', header: 'HEALTH', width: 12, render: row => row.health },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No search tables are registered.' }]} color={color} />
        )}
      </Section>
    </Box>
  )
}

export function ReindexReport({ result, target = 'all content', rebuild = false, color = true }: {
  result: ReindexResultData
  target?: string
  rebuild?: boolean
  color?: boolean
}) {
  const rows = reindexTableRows(result.tables ?? [])
  const total = numberValue(result.total)
  const errors = numberValue(result.errors)
  const enrichmentErrors = numberValue(result.enrichmentErrors)

  return (
    <Box flexDirection="column">
      <ScreenHeader
        title="Reindex"
        subtitle={rebuild ? 'Search content indexed with rebuilt indexes' : 'Search content indexed'}
        meta={`target: ${target}`}
        color={color}
      />
      <SummaryStrip items={[
        { label: plural(total, 'document'), value: total, status: total > 0 ? 'ok' : 'skip' },
        { label: plural(rows.length, 'table'), value: rows.length, status: rows.length > 0 ? 'ok' : 'skip' },
        { label: 'errors', value: errors, status: errors > 0 ? 'fail' : 'ok' },
        { label: 'enrichment', value: enrichmentErrors, status: enrichmentErrors > 0 ? 'warn' : 'ok' },
      ]} color={color} />
      <Section title="Tables" color={color}>
        {rows.length > 0 ? (
          <StatusTable
            rows={rows}
            columns={[
              { key: 'table', header: 'TABLE', width: 16, render: row => row.table },
              { key: 'docs', header: 'DOCS', width: 6, render: row => row.docs },
              { key: 'enrichment', header: 'ENRICHMENT', width: 18, render: row => row.enrichment },
              { key: 'issue', header: 'ISSUE', width: 24, grow: true, render: row => row.issue },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No reindex table results returned.' }]} color={color} />
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

export function PackageActionReport({ actions, color = true }: {
  actions: PackageActionData[]
  color?: boolean
}) {
  const applied = actions.filter(action => packageActionStatus(action) === 'applied').length
  const failed = actions.filter(action => packageActionStatus(action) === 'fail').length
  const skipped = actions.filter(action => packageActionStatus(action) === 'ok').length
  const meta = actions.length === 1 ? valueText(actions[0]?.action, 'updated') : `${actions.length} actions`

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Package action" subtitle="Package state updated" meta={meta} color={color} />
      <SummaryStrip items={[
        { label: plural(actions.length, 'action'), value: actions.length, status: actions.length > 0 ? 'applied' : 'skip' },
        { label: 'applied', value: applied, status: applied > 0 ? 'applied' : 'skip' },
        { label: 'unchanged', value: skipped, status: skipped > 0 ? 'ok' : 'skip' },
        { label: 'failed', value: failed, status: failed > 0 ? 'fail' : 'ok' },
      ]} color={color} />
      <Section title="Result" color={color}>
        <FindingRows rows={packageActionRows(actions)} color={color} />
        <Text> </Text>
      </Section>
    </Box>
  )
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

export function TrashListReport({ assets, color = true }: {
  assets: TrashAssetData[]
  color?: boolean
}) {
  const rows = trashAssetTableRows(assets)

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Trash" subtitle="Soft-deleted assets" color={color} />
      <SummaryStrip items={[
        { label: plural(rows.length, 'item'), value: rows.length, status: rows.length > 0 ? 'warn' : 'skip' },
      ]} color={color} />
      <Section title="Trashed assets" color={color}>
        {rows.length > 0 ? (
          <StatusTable
            rows={rows}
            columns={[
              { key: 'filename', header: 'FILENAME', width: 18, render: row => row.filename },
              { key: 'type', header: 'TYPE', width: 8, render: row => row.type },
              { key: 'size', header: 'SIZE', width: 7, render: row => row.size },
              { key: 'deleted', header: 'DELETED', width: 16, render: row => row.deleted },
              { key: 'expires', header: 'EXPIRES', width: 7, render: row => row.expires },
              { key: 'agent', header: 'AGENT', width: 8, render: row => row.agent },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'Trash is empty.' }]} color={color} />
        )}
      </Section>
      <Section title="Restore" color={color}>
        <FindingRows rows={[{
          status: 'ready',
          label: 'command',
          message: 'bakin trash restore <trashName>',
          detail: 'Use the full trash filename with the __deleted- suffix.',
        }]} color={color} />
      </Section>
    </Box>
  )
}

export function TrashActionReport({ action, color = true }: {
  action: TrashActionData
  color?: boolean
}) {
  const actionName = valueText(action.action, 'updated')
  const count = valueText(action.count, '')

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Trash action" subtitle="Soft-deleted assets updated" meta={actionName} color={color} />
      <SummaryStrip items={[
        { label: 'action', value: actionName, status: trashActionStatus(action) },
        { label: 'items', value: count || '-', status: count ? 'ok' : 'skip' },
      ]} color={color} />
      <Section title="Result" color={color}>
        <FindingRows rows={trashActionRows(action)} color={color} />
        <Text> </Text>
      </Section>
    </Box>
  )
}
