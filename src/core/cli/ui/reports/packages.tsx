import { Box, Text } from 'ink'
import { FindingRows, ScreenHeader, Section, StatusTable, SummaryStrip, type FindingRow } from '../tui'
import type { TuiStatus } from '../style-tokens'
import { valueText, listText, objectField, isPlainRecord, plural } from './format'

export interface AgentPackageData {
  agentId?: unknown
  state?: unknown
  version?: unknown
  packageId?: unknown
  entry?: unknown
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

interface AgentPackageTableRow {
  status: TuiStatus
  agent: string
  state: string
  version: string
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
  if (name === 'synced' || name === 'checked') {
    const receipt = objectField(payload, 'receipt')
    const verification = isPlainRecord(receipt) ? objectField(receipt, 'verification') : undefined
    const status = isPlainRecord(verification) ? valueText(objectField(verification, 'status'), '') : ''
    const verb = name === 'checked' ? 'Checked' : 'Synced'
    return `${verb} ${scope} ${target}${status ? ` — verification ${status}` : ''}.`
  }
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${scope} ${target}.`
}

/** Receipt detail lines for sync/check actions (layered-context spec). */
function syncReceiptDetails(receipt: unknown): string[] {
  if (!isPlainRecord(receipt)) return []
  const details: string[] = []

  const pkg = objectField(receipt, 'package')
  if (isPlainRecord(pkg)) {
    const before = valueText(objectField(pkg, 'versionBefore'), '')
    const after = valueText(objectField(pkg, 'versionAfter'), '')
    if (before && after && before !== after) {
      details.push(`Version: ${before} -> ${after}`)
    } else if (objectField(pkg, 'fetched') === true && objectField(pkg, 'changed') === false) {
      details.push('Upstream unchanged.')
    }
  }

  const blocks = objectField(receipt, 'blocks')
  if (Array.isArray(blocks)) {
    const recomposed = blocks
      .filter((b): b is Record<string, unknown> => isPlainRecord(b) && b.action === 'recomposed')
      .map((b) => valueText(b.file, ''))
      .filter(Boolean)
    if (recomposed.length > 0) details.push(`Blocks recomposed: ${recomposed.join(', ')}`)
  }

  const projections = objectField(receipt, 'projections')
  if (Array.isArray(projections) && projections.length > 0) {
    const reclaimed = projections.filter((pr) => isPlainRecord(pr) && pr.action === 'reclaimed').length
    details.push(`Projections written: ${projections.length}${reclaimed > 0 ? ` (${reclaimed} reclaimed)` : ''}`)
  }

  const skipped = objectField(receipt, 'skipped')
  if (Array.isArray(skipped)) {
    for (const entry of skipped) {
      if (!isPlainRecord(entry)) continue
      const hint = valueText(entry.hint, '')
      details.push(`Skipped (user-edited; your changes preserved): ${valueText(entry.target, '')}${hint ? `\n  Reclaim: ${hint}` : ''}`)
    }
  }

  const verification = objectField(receipt, 'verification')
  if (isPlainRecord(verification) && Array.isArray(verification.findings)) {
    for (const finding of verification.findings as unknown[]) {
      if (!isPlainRecord(finding)) continue
      details.push(`Finding: ${valueText(finding.message, '')}`)
    }
  }

  return details.filter(Boolean)
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

  details.push(...syncReceiptDetails(objectField(payload, 'receipt')))
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

function packageStateStatus(state: string): TuiStatus {
  switch (state) {
    case 'managed':
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
    const entry = isPlainRecord(agent.entry) ? agent.entry : {}
    return {
      status: packageStateStatus(state),
      agent: valueText(agent.agentId),
      state,
      version: valueText(agent.version ?? entry.version),
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

export function AgentPackagesListReport({ agents, color = true }: {
  agents: AgentPackageData[]
  color?: boolean
}) {
  const rows = agentPackageTableRows(agents)
  const managed = rows.filter(row => row.state === 'managed').length

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Agent Packages" subtitle="Installed agent package state" color={color} />
      <SummaryStrip items={[
        { label: plural(rows.length, 'agent'), value: rows.length, status: rows.length > 0 ? 'ok' : 'skip' },
        { label: 'managed', value: managed, status: managed > 0 ? 'ok' : 'skip' },
      ]} color={color} />
      <Section title="Package state" color={color}>
        {rows.length > 0 ? (
          <StatusTable
            rows={rows}
            columns={[
              { key: 'agent', header: 'AGENT', width: 18, render: row => row.agent },
              { key: 'state', header: 'STATE', width: 12, render: row => row.state },
              { key: 'version', header: 'VERSION', width: 12, render: row => row.version },
              { key: 'package', header: 'PACKAGE', width: 28, grow: true, render: row => row.package },
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
