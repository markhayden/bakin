#!/usr/bin/env bun
/**
 * Bakin CLI — command-line interface for Bakin orchestration platform.
 * All commands are thin wrappers around the Bakin HTTP API.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import {
  cmdScheduleList, cmdScheduleAdd, cmdSchedulePause,
  cmdScheduleResume, cmdScheduleRemove, cmdScheduleRun, cmdScheduleRuns,
} from '../src/cli/schedule'
import { renderCliUsage } from '../src/core/cli/registry'
import { parsePluginInstallArgs, PLUGIN_INSTALL_USAGE } from '../src/core/cli/plugin-install-args'
import {
  createPluginExportManifest,
  installPluginExportManifest,
  parsePluginExportManifest,
  serializePluginExportManifest,
  type PluginImportInstallRequest,
} from '../src/core/plugins/import-export'
import type {
  SearchAggregationsData,
  SearchMetaData,
  SearchResultData,
} from '../src/core/cli/ui/readonly'

const BASE_URL = process.env.BAKIN_URL || 'http://localhost:3737'

// Lazy so importing this module (e.g. from src/core/cli.ts when the
// compiled binary delegates unknown commands here) does not initialize
// runtime services at binary startup. Resolved once on first use.
let __cliAgent: string | undefined
async function getCliAgent(): Promise<string> {
  if (__cliAgent === undefined) {
    const roster = await getCliRoster()
    __cliAgent = roster.mainAgentId ?? roster.agentIds[0] ?? 'main'
  }
  return __cliAgent
}

interface CliRoster {
  agentIds: string[]
  mainAgentId?: string | null
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
async function api(path: string, options?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status}: ${body}`)
  }
  return res.json()
}

async function apiGet(path: string): Promise<unknown> {
  return api(path)
}

async function getCliRoster(): Promise<CliRoster> {
  const result = await apiGet('/api/plugins/team/') as {
    agents?: Array<{ id?: unknown }>
    mainAgentId?: string | null
  }
  return {
    agentIds: (result.agents ?? [])
      .map((agent) => agent.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
    mainAgentId: result.mainAgentId,
  }
}

async function apiPost(path: string, body?: unknown): Promise<unknown> {
  return api(path, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  })
}

async function apiDelete(path: string, body?: unknown): Promise<unknown> {
  return api(path, {
    method: 'DELETE',
    body: body ? JSON.stringify(body) : undefined,
  })
}

function print(data: unknown): void {
  if (typeof data === 'string') {
    console.log(data)
  } else {
    console.log(JSON.stringify(data, null, 2))
  }
}

function printTable(rows: Record<string, unknown>[], columns?: string[]): void {
  if (rows.length === 0) {
    console.log('(none)')
    return
  }
  const cols = columns || Object.keys(rows[0])
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)))

  const header = cols.map((c, i) => c.padEnd(widths[i])).join('  ')
  const sep = cols.map((_, i) => '-'.repeat(widths[i])).join('  ')
  console.log(header)
  console.log(sep)
  for (const row of rows) {
    console.log(cols.map((c, i) => String(row[c] ?? '').padEnd(widths[i])).join('  '))
  }
}

async function printStatusTui(dispatch: Record<string, unknown>, roster: CliRoster): Promise<void> {
  const [{ StatusReport }, { renderToString }, { createElement }] = await Promise.all([
    import('../src/core/cli/ui/readonly'),
    import('ink'),
    import('react'),
  ])
  console.log(renderToString(createElement(StatusReport, { dispatch, roster })))
}

async function printTasksListTui(columns: Record<string, Array<Record<string, unknown>>>, column?: string): Promise<void> {
  const [{ TasksListReport }, { renderToString }, { createElement }] = await Promise.all([
    import('../src/core/cli/ui/readonly'),
    import('ink'),
    import('react'),
  ])
  console.log(renderToString(createElement(TasksListReport, { columns, column })))
}

async function printTaskDetailTui(taskId: string, column: string, task: Record<string, unknown>): Promise<void> {
  const [{ TaskDetailReport }, { renderToString }, { createElement }] = await Promise.all([
    import('../src/core/cli/ui/readonly'),
    import('ink'),
    import('react'),
  ])
  console.log(renderToString(createElement(TaskDetailReport, { taskId, column, task })))
}

async function printAgentsListTui(agents: Array<{ id: string; name: string; status: string; model: string }>): Promise<void> {
  const [{ AgentsListReport }, { renderToString }, { createElement }] = await Promise.all([
    import('../src/core/cli/ui/readonly'),
    import('ink'),
    import('react'),
  ])
  console.log(renderToString(createElement(AgentsListReport, { agents })))
}

async function printAgentStatusTui(agentId: string, profile: Record<string, unknown>): Promise<void> {
  const [{ AgentStatusReport }, { renderToString }, { createElement }] = await Promise.all([
    import('../src/core/cli/ui/readonly'),
    import('ink'),
    import('react'),
  ])
  console.log(renderToString(createElement(AgentStatusReport, { agentId, profile })))
}

async function printAgentTasksTui(agentId: string, tasks: Array<Record<string, unknown>>): Promise<void> {
  const [{ AgentTasksReport }, { renderToString }, { createElement }] = await Promise.all([
    import('../src/core/cli/ui/readonly'),
    import('ink'),
    import('react'),
  ])
  console.log(renderToString(createElement(AgentTasksReport, { agentId, tasks })))
}

async function printPluginsListTui(routes: Array<Record<string, unknown>>): Promise<void> {
  const [{ PluginsListReport }, { renderToString }, { createElement }] = await Promise.all([
    import('../src/core/cli/ui/readonly'),
    import('ink'),
    import('react'),
  ])
  console.log(renderToString(createElement(PluginsListReport, { routes })))
}

async function printDocsTui(routes: Array<Record<string, unknown>>): Promise<void> {
  const [{ DocsReport }, { renderToString }, { createElement }] = await Promise.all([
    import('../src/core/cli/ui/readonly'),
    import('ink'),
    import('react'),
  ])
  console.log(renderToString(createElement(DocsReport, { routes })))
}

async function printWorkflowsListTui(templates: Array<Record<string, unknown>>): Promise<void> {
  const [{ WorkflowsListReport }, { renderToString }, { createElement }] = await Promise.all([
    import('../src/core/cli/ui/readonly'),
    import('ink'),
    import('react'),
  ])
  console.log(renderToString(createElement(WorkflowsListReport, { templates })))
}

async function printSearchResultsTui(query: string, result: Record<string, unknown>): Promise<void> {
  const [{ SearchResultsReport }, { renderToString }, { createElement }] = await Promise.all([
    import('../src/core/cli/ui/readonly'),
    import('ink'),
    import('react'),
  ])
  const results = Array.isArray(result.results) ? result.results as SearchResultData[] : []
  const aggregations = result.aggregations && typeof result.aggregations === 'object' && !Array.isArray(result.aggregations)
    ? result.aggregations as SearchAggregationsData
    : undefined
  const meta = result.meta && typeof result.meta === 'object' && !Array.isArray(result.meta)
    ? result.meta as SearchMetaData
    : undefined
  console.log(renderToString(createElement(SearchResultsReport, {
    query,
    results,
    aggregations,
    meta,
  })))
}

async function printSearchStatsTui(enabled: boolean, tables: Array<Record<string, unknown>>): Promise<void> {
  const [{ SearchStatsReport }, { renderToString }, { createElement }] = await Promise.all([
    import('../src/core/cli/ui/readonly'),
    import('ink'),
    import('react'),
  ])
  console.log(renderToString(createElement(SearchStatsReport, { enabled, tables })))
}

async function printTrashListTui(assets: Array<Record<string, unknown>>): Promise<void> {
  const [{ TrashListReport }, { renderToString }, { createElement }] = await Promise.all([
    import('../src/core/cli/ui/readonly'),
    import('ink'),
    import('react'),
  ])
  console.log(renderToString(createElement(TrashListReport, { assets })))
}

async function printAgentPackagesListTui(agents: Array<Record<string, unknown>>): Promise<void> {
  const [{ AgentPackagesListReport }, { renderToString }, { createElement }] = await Promise.all([
    import('../src/core/cli/ui/readonly'),
    import('ink'),
    import('react'),
  ])
  console.log(renderToString(createElement(AgentPackagesListReport, { agents })))
}

async function printAgentLessonsListTui(
  agentId: string,
  packageId: string,
  lessons: Array<Record<string, unknown>>,
): Promise<void> {
  const [{ AgentLessonsListReport }, { renderToString }, { createElement }] = await Promise.all([
    import('../src/core/cli/ui/readonly'),
    import('ink'),
    import('react'),
  ])
  console.log(renderToString(createElement(AgentLessonsListReport, { agentId, packageId, lessons })))
}

async function printPackagesListTui(packages: Array<Record<string, unknown>>): Promise<void> {
  const [{ PackagesListReport }, { renderToString }, { createElement }] = await Promise.all([
    import('../src/core/cli/ui/readonly'),
    import('ink'),
    import('react'),
  ])
  console.log(renderToString(createElement(PackagesListReport, { packages })))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
async function cmdStatus(): Promise<void> {
  const dispatch = await apiGet('/api/dispatch') as Record<string, unknown>
  const roster = await getCliRoster()

  if (process.stdout.isTTY) {
    await printStatusTui(dispatch, roster)
    return
  }

  console.log('=== Bakin Status ===')
  console.log(`Dispatch interval: ${dispatch.intervalMin}min`)
  console.log(`Last run: ${dispatch.lastRun || 'never'}`)
  console.log(`Next run: ${dispatch.nextRun} (${dispatch.secondsUntilNext}s)`)
  console.log(`Tasks dispatched: ${dispatch.dispatchedCount}`)
  console.log(`Agents: ${roster.agentIds.join(', ')}`)
}

async function cmdDispatch(): Promise<void> {
  const result = await apiPost('/api/dispatch')
  print(result)
}

async function cmdTasksList(column?: string): Promise<void> {
  // Read tasks from the API
  const result = await apiGet('/api/plugins/tasks/') as { columns: Record<string, Array<Record<string, unknown>>> }
  const columns = result.columns || {}

  if (column) {
    const col = columns[column]
    if (!col) {
      console.error(`Unknown column: ${column}. Available: ${Object.keys(columns).join(', ')}`)
      process.exit(1)
    }
    if (process.stdout.isTTY) {
      await printTasksListTui({ [column]: col as Array<Record<string, unknown>> }, column)
      return
    }
    printTable(col as Record<string, unknown>[], ['id', 'title', 'agent'])
  } else {
    if (process.stdout.isTTY) {
      await printTasksListTui(columns as Record<string, Array<Record<string, unknown>>>)
      return
    }
    for (const [name, tasks] of Object.entries(columns)) {
      if ((tasks as unknown[]).length === 0) continue
      console.log(`\n=== ${name} ===`)
      printTable(tasks as Record<string, unknown>[], ['id', 'title', 'agent'])
    }
  }
}

async function cmdTasksCreate(title: string, assignee?: string, workflowId?: string, skipWorkflowReason?: string): Promise<void> {
  const body: Record<string, string> = { title }
  if (assignee) body.assignee = assignee
  if (workflowId) body.workflowId = workflowId
  if (skipWorkflowReason) body.skipWorkflowReason = skipWorkflowReason
  const result = await apiPost('/api/plugins/tasks/', body) as { ok?: boolean; id?: string; workflowId?: string; suggestedWorkflow?: string; error?: string }

  if (result.error) {
    console.error(`Error: ${result.error}`)
    process.exit(1)
  }

  // Warn if a workflow was suggested but not used and no reason given
  if (result.suggestedWorkflow && !workflowId && !skipWorkflowReason) {
    console.warn(`\n⚠  Workflow "${result.suggestedWorkflow}" matches this task but was not started.`)
    console.warn(`   Re-run with --workflow=${result.suggestedWorkflow} to use it,`)
    console.warn(`   or --no-workflow="<reason>" to skip with an audit trail.\n`)
  }

  print(result)
}

async function cmdTasksMove(id: string, to: string): Promise<void> {
  const result = await apiPost(`/api/plugins/tasks/${id}/move`, { id, to, agent: await getCliAgent() })
  print(result)
}

async function cmdAgentsList(): Promise<void> {
  const result = await apiGet('/api/plugins/team/') as {
    agents: Array<{ id: string; name: string; status: string; model: string }>
  }
  if (process.stdout.isTTY) {
    await printAgentsListTui(result.agents)
    return
  }
  for (const agent of result.agents) {
    const statusIcon = agent.status === 'working' ? '●' : agent.status === 'online' ? '○' : '·'
    console.log(`  ${statusIcon} ${agent.id}: ${agent.name} [${agent.status}] (${agent.model})`)
  }
}

async function cmdAgentsSend(agentId: string, message: string): Promise<void> {
  const result = await apiPost(`/api/agents/${agentId}/message`, { message })
  print(result)
}

async function cmdAgentsStatus(agentId: string): Promise<void> {
  const result = await apiGet(`/api/plugins/team/${agentId}`) as Record<string, unknown>
  if (process.stdout.isTTY) {
    await printAgentStatusTui(agentId, result)
    return
  }
  print(result)
}

async function cmdAgentsTasks(agentId: string): Promise<void> {
  const result = await apiGet(`/api/agents/${agentId}/tasks`) as { tasks: Array<Record<string, unknown>> }
  if (process.stdout.isTTY) {
    await printAgentTasksTui(agentId, result.tasks)
    return
  }
  printTable(result.tasks, ['id', 'title', 'column'])
}

async function cmdSettingsGet(key?: string): Promise<void> {
  const settings = await apiGet('/api/settings') as Record<string, unknown>
  if (key) {
    const parts = key.split('.')
    let val: unknown = settings
    for (const part of parts) {
      if (val && typeof val === 'object') val = (val as Record<string, unknown>)[part]
      else val = undefined
    }
    print(val)
  } else {
    print(settings)
  }
}

async function cmdSettingsSet(key: string, value: string): Promise<void> {
  const parts = key.split('.')
  const obj: Record<string, unknown> = {}
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = {}
    current = current[parts[i]] as Record<string, unknown>
  }

  // Try to parse as JSON, fall back to string
  try {
    current[parts[parts.length - 1]] = JSON.parse(value)
  } catch {
    current[parts[parts.length - 1]] = value
  }

  const result = await apiPost('/api/settings', obj)
  print(result)
}

async function cmdPluginsList(): Promise<void> {
  const docs = await apiGet('/api/docs') as { routes: Array<Record<string, unknown>> }
  const plugins = new Set<string>()
  for (const route of docs.routes) {
    if (route.pluginId !== 'core') plugins.add(route.pluginId as string)
  }
  if (process.stdout.isTTY) {
    await printPluginsListTui(docs.routes)
    return
  }
  console.log('Installed plugins:')
  for (const p of plugins) {
    const routeCount = docs.routes.filter(r => r.pluginId === p).length
    console.log(`  ${p} (${routeCount} routes)`)
  }
}

async function cmdPluginsInstall(source: string, opts: { yes?: boolean; dev?: boolean; force?: boolean; ref?: string } = {}): Promise<void> {
  const type = !opts.dev && (source.startsWith('github:') || source.includes('/') && !source.startsWith('.') && !source.startsWith('/'))
    ? 'github'
    : 'local'
  const result = await apiPost('/api/plugins/install', {
    source,
    type,
    ref: opts.ref,
    accepted: false,
    dev: opts.dev === true,
    force: opts.force === true,
  }) as {
    awaitingConsent?: boolean
    consentToken?: string
  }
  if (opts.yes && result.awaitingConsent && result.consentToken) {
    const accepted = await apiPost('/api/plugins/install', {
      source,
      type,
      ref: opts.ref,
      accepted: true,
      consentToken: result.consentToken,
      dev: opts.dev === true,
      force: opts.force === true,
    })
    print(accepted)
  } else {
    print(result)
  }
}

async function cmdPluginsExport(file?: string): Promise<void> {
  const manifest = createPluginExportManifest()
  const content = serializePluginExportManifest(manifest)
  if (file) {
    writeFileSync(file, content, 'utf-8')
    console.log(`Exported ${manifest.plugins.length} plugin(s) to ${file}`)
  } else {
    process.stdout.write(content)
  }
}

async function installImportedPluginLegacy(
  request: PluginImportInstallRequest,
  opts: { yes: boolean; force: boolean },
): Promise<void> {
  console.log(`Installing ${request.id} from ${request.source}${request.ref ? ` @ ${request.ref.slice(0, 12)}` : ''}`)
  let result = await apiPost('/api/plugins/install', {
    source: request.source,
    type: request.type,
    ref: request.ref,
    accepted: false,
    dev: request.dev,
    force: opts.force,
  }) as {
    error?: string
    awaitingConsent?: boolean
    consentToken?: string
    message?: string
    id?: string
  }
  if (result.error) throw new Error(result.error)

  for (let attempt = 0; attempt < 3 && result.awaitingConsent; attempt++) {
    if (!opts.yes) {
      throw new Error(`plugin "${request.id}" requires permission consent; rerun with --yes or install it directly`)
    }
    result = await apiPost('/api/plugins/install', {
      source: request.source,
      type: request.type,
      ref: request.ref,
      accepted: true,
      consentToken: result.consentToken,
      dev: request.dev,
      force: opts.force,
    }) as typeof result
    if (result.error) throw new Error(result.error)
  }

  if (result.awaitingConsent) {
    throw new Error(`plugin "${request.id}" manifest kept changing between preflight and commit`)
  }
  console.log(result.message ?? `Installed "${result.id ?? request.id}".`)
}

async function cmdPluginsImport(file: string, opts: { yes: boolean; force: boolean }): Promise<void> {
  const manifest = parsePluginExportManifest(readFileSync(file, 'utf-8'))
  const result = await installPluginExportManifest(
    manifest,
    request => installImportedPluginLegacy(request, opts),
  )
  if (result.ok) {
    console.log(`Imported ${result.installed.length} plugin(s).`)
    return
  }
  console.error(`Import failed after installing ${result.installed.length} plugin(s).`)
  for (const failure of result.failed) {
    console.error(`  ${failure.id}: ${failure.error}`)
  }
  process.exit(1)
}

async function cmdPluginsRemove(pluginId: string): Promise<void> {
  const result = await apiPost('/api/plugins/remove', { pluginId })
  print(result)
}

interface PluginRestoreSnapshot {
  timestamp: string
  createdAt: string
  filename: string
  sizeBytes: number
}

interface PluginRestoreResult {
  ok?: boolean
  error?: string
  core?: boolean
  message?: string
  snapshot?: string
  snapshotInfo?: PluginRestoreSnapshot
  snapshots?: PluginRestoreSnapshot[]
  skills?: { restored: number }
  restored?: boolean
  activated?: boolean
}

const PLUGIN_RESTORE_USAGE = 'Usage: bakin plugins restore <id> [--snapshot <snapshot>] [--force] [--list]'

function parsePluginRestoreFlags(flags: string[]): {
  snapshot?: string
  force: boolean
  list: boolean
  error?: string
} {
  let snapshot: string | undefined
  let force = false
  let list = false
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i]
    if (flag === '--force') {
      force = true
      continue
    }
    if (flag === '--list') {
      list = true
      continue
    }
    if (flag === '--snapshot') {
      const value = flags[i + 1]
      if (!value || value.startsWith('--')) return { force, list, error: '--snapshot requires a timestamp or filename' }
      snapshot = value
      i++
      continue
    }
    return { force, list, error: `Unknown plugins restore argument: ${flag}` }
  }
  return { snapshot, force, list }
}

function printPluginRestoreSnapshots(pluginId: string, snapshots: PluginRestoreSnapshot[] = []): void {
  if (snapshots.length === 0) {
    console.log(`No uninstall snapshots found for plugin "${pluginId}".`)
    return
  }
  console.log(`Uninstall snapshots for ${pluginId}:`)
  for (const snapshot of snapshots) {
    const kb = Math.max(1, Math.ceil(snapshot.sizeBytes / 1024))
    console.log(`  ${snapshot.timestamp}  ${snapshot.createdAt}  ${kb}KB  ${snapshot.filename}`)
  }
}

async function cmdPluginsRestore(pluginId: string, opts: { snapshot?: string; force: boolean; list: boolean }): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/plugins/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pluginId,
      snapshot: opts.snapshot,
      force: opts.force,
      listOnly: opts.list,
    }),
  })
  const result = await res.json().catch(() => ({})) as PluginRestoreResult
  if (opts.list) {
    if (result.error) throw new Error(result.error)
    printPluginRestoreSnapshots(pluginId, result.snapshots)
    return
  }
  if (!res.ok || result.error) {
    if (result.snapshots && result.snapshots.length > 0) printPluginRestoreSnapshots(pluginId, result.snapshots)
    throw new Error(result.error ?? `HTTP ${res.status}`)
  }
  console.log(result.message ?? `Restored plugin: ${pluginId}`)
  if (result.snapshotInfo) {
    console.log(`  Snapshot: ${result.snapshotInfo.filename}`)
  } else if (result.snapshot) {
    console.log(`  Snapshot: ${result.snapshot}`)
  }
  if (result.skills) console.log(`  Runtime skills restored: ${result.skills.restored}`)
  if (result.activated === false) console.log('  Activation deferred until next server start.')
}

async function cmdPluginsLink(localPath: string, opts: { force?: boolean } = {}): Promise<void> {
  const result = await apiPost('/api/plugins/link', {
    localPath,
    force: opts.force === true,
  })
  print(result)
}

async function cmdPluginsUnlink(pluginId: string): Promise<void> {
  const result = await apiPost('/api/plugins/unlink', { pluginId })
  print(result)
}

// ---------------------------------------------------------------------------
// Agent-package commands — `bakin agents ...`
// ---------------------------------------------------------------------------

interface AgentsCmdFlags {
  adopt?: boolean
  installAs?: string
  replace?: boolean
  keepBlocks?: boolean
  deleteAgent?: boolean
  refreshTemplate?: boolean
  force?: boolean
  json?: boolean
}

async function cmdAgentPackagesInstall(source: string, flags: AgentsCmdFlags): Promise<void> {
  const body: Record<string, unknown> = { source }
  if (flags.adopt) body.adopt = source // installer reads any truthy adopt as the agentId
  if (flags.installAs) body.installAs = flags.installAs
  if (flags.replace) body.replace = true
  const result = await apiPost('/api/agent-packages/install', body)
  print(result)
}

async function cmdAgentPackagesList(flags: AgentsCmdFlags): Promise<void> {
  const result = await apiGet('/api/agent-packages') as {
    ok: boolean
    agents: Array<{ agentId: string; state: string; packageId?: string }>
  }
  if (flags.json) {
    print(result)
    return
  }
  if (process.stdout.isTTY) {
    await printAgentPackagesListTui(result.agents)
    return
  }
  console.log('Agents (package state):')
  for (const a of result.agents) {
    const pkg = a.packageId ? `  [${a.packageId}]` : ''
    console.log(`  ${a.agentId.padEnd(20)} ${a.state}${pkg}`)
  }
}

async function cmdAgentPackagesRemove(agentId: string, flags: AgentsCmdFlags): Promise<void> {
  const body: Record<string, unknown> = {}
  if (flags.keepBlocks) body.keepBlocks = true
  if (flags.deleteAgent) body.deleteAgent = true
  if (flags.force) body.force = true
  const result = await apiDelete(`/api/agent-packages/${encodeURIComponent(agentId)}`, body)
  print(result)
}

async function cmdAgentPackagesUpdate(agentId: string | undefined, flags: AgentsCmdFlags): Promise<void> {
  const body: Record<string, unknown> = {}
  if (flags.refreshTemplate) body.refreshTemplate = true

  if (agentId) {
    const result = await apiPost(`/api/agent-packages/${encodeURIComponent(agentId)}/update`, body)
    print(result)
    return
  }

  // No agentId — update every managed agent package.
  const list = await apiGet('/api/agent-packages') as {
    agents: Array<{ agentId: string; state: string }>
  }
  for (const a of list.agents) {
    if (a.state !== 'managed' && a.state !== 'adopted') continue
    try {
      const result = await apiPost(`/api/agent-packages/${encodeURIComponent(a.agentId)}/update`, body)
      console.log(`${a.agentId}:`)
      print(result)
    } catch (err) {
      console.error(`${a.agentId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function cmdAgentPackagesLessonsList(agentId: string): Promise<void> {
  const result = await apiGet(`/api/agent-packages/${encodeURIComponent(agentId)}/lessons`) as {
    ok: boolean
    packageId: string
    lessons: Array<{ lessonId: string; title: string; tags: string[]; enabled: boolean }>
  }
  if (process.stdout.isTTY) {
    await printAgentLessonsListTui(agentId, result.packageId, result.lessons)
    return
  }
  console.log(`Lessons for ${agentId} (package: ${result.packageId})`)
  for (const l of result.lessons) {
    const mark = l.enabled ? '[x]' : '[ ]'
    const tags = l.tags.length > 0 ? ` (${l.tags.join(', ')})` : ''
    console.log(`  ${mark} ${l.lessonId.padEnd(30)} ${l.title}${tags}`)
  }
}

async function cmdAgentPackagesLessonsToggle(agentId: string, lessonId: string, enabled: boolean): Promise<void> {
  const result = await apiPost(
    `/api/agent-packages/${encodeURIComponent(agentId)}/lessons/${encodeURIComponent(lessonId)}`,
    { enabled },
  )
  print(result)
}

// ---------------------------------------------------------------------------
// Standalone-pack commands — `bakin packages ...`
// ---------------------------------------------------------------------------

async function cmdPackagesList(flags: AgentsCmdFlags): Promise<void> {
  const result = await apiGet('/api/packages') as {
    ok: boolean
    packages: Array<{
      id: string; kind: string; version: string; refCount: number; dependents: string[]
    }>
  }
  if (flags.json) {
    print(result)
    return
  }
  if (process.stdout.isTTY) {
    await printPackagesListTui(result.packages)
    return
  }
  console.log('Installed packages:')
  for (const p of result.packages) {
    const refs = p.refCount > 0 ? `  (refCount=${p.refCount}: ${p.dependents.join(', ')})` : ''
    console.log(`  ${p.id.padEnd(40)} ${p.kind.padEnd(15)} ${p.version}${refs}`)
  }
}

async function cmdPackagesInstall(source: string, flags: AgentsCmdFlags): Promise<void> {
  const body: Record<string, unknown> = { source }
  if (flags.installAs) body.installAs = flags.installAs
  if (flags.replace) body.replace = true
  const result = await apiPost('/api/packages/install', body)
  print(result)
}

async function cmdPackagesRemove(packageId: string, flags: AgentsCmdFlags): Promise<void> {
  const body: Record<string, unknown> = {}
  if (flags.keepBlocks) body.keepBlocks = true
  if (flags.force) body.force = true
  const result = await apiDelete(`/api/packages/${encodeURIComponent(packageId)}`, body)
  print(result)
}

async function cmdPackagesUpdate(packageId: string, flags: AgentsCmdFlags): Promise<void> {
  const body: Record<string, unknown> = {}
  if (flags.refreshTemplate) body.refreshTemplate = true
  const result = await apiPost(`/api/packages/${encodeURIComponent(packageId)}/update`, body)
  print(result)
}

/** Parse a flag-style argv tail (everything after the positional args). */
function parseAgentsFlags(args: string[]): AgentsCmdFlags {
  const flags: AgentsCmdFlags = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    switch (a) {
      case '--adopt':
        flags.adopt = true
        break
      case '--install-as':
        flags.installAs = args[++i]
        break
      case '--replace':
        flags.replace = true
        break
      case '--keep-blocks':
        flags.keepBlocks = true
        break
      case '--delete-agent':
        flags.deleteAgent = true
        break
      case '--refresh-template':
        flags.refreshTemplate = true
        break
      case '--force':
        flags.force = true
        break
      case '--json':
        flags.json = true
        break
    }
  }
  return flags
}

async function cmdDocs(): Promise<void> {
  const docs = await apiGet('/api/docs') as { routes: Array<Record<string, unknown>> }
  if (process.stdout.isTTY) {
    await printDocsTui(docs.routes)
    return
  }
  for (const route of docs.routes) {
    const desc = route.description ? ` — ${route.description}` : ''
    console.log(`${route.method} ${route.fullPath}${desc}`)
  }
}

async function cmdSearch(query: string, options: { table?: string; limit?: number; agent?: string; facets?: string } = {}): Promise<void> {
  let url = `/api/search?q=${encodeURIComponent(query)}`
  if (options.table) url += `&table=${encodeURIComponent(options.table)}`
  if (options.limit) url += `&limit=${options.limit}`
  if (options.facets) url += `&facets=${encodeURIComponent(options.facets)}`
  const result = await apiGet(url) as {
    results?: Array<{ key: string; score?: number; _table?: string; document?: Record<string, unknown> }>
    aggregations?: Record<string, Array<{ value: string; count: number }>>
    meta?: { query: string; total: number; took_ms: number; source: string }
  }

  if (process.stdout.isTTY) {
    await printSearchResultsTui(query, result as Record<string, unknown>)
    return
  }

  if (result.meta) {
    console.log(`Search: "${result.meta.query}" — ${result.meta.total} results in ${result.meta.took_ms}ms (${result.meta.source})`)
  }

  if (result.results?.length) {
    for (const r of result.results) {
      const table = r._table ? ` [${r._table.replace('bakin_', '')}]` : ''
      const title = r.document?.title || r.document?.name || r.key
      console.log(`  ${title}${table} (score: ${r.score?.toFixed(3) ?? '?'})`)
    }
  } else {
    console.log('  No results found.')
  }

  if (result.aggregations && Object.keys(result.aggregations).length) {
    console.log('')
    for (const [facet, values] of Object.entries(result.aggregations)) {
      console.log(`  ${facet}: ${values.map(v => `${v.value}(${v.count})`).join(', ')}`)
    }
  }
}

async function cmdSearchStats(): Promise<void> {
  const result = await apiGet('/api/plugins/health/search-status') as {
    enabled: boolean
    tables: Array<{
      table: string
      pluginId: string
      stats: Record<string, unknown> | null
      indexHealth?: Array<{ name: string; error?: string; walBacklog: number; rebuilding: boolean }>
      healthy?: boolean
    }>
  }
  if (process.stdout.isTTY) {
    await printSearchStatsTui(result.enabled, result.tables as Array<Record<string, unknown>>)
    return
  }
  console.log(`Search: ${result.enabled ? 'enabled' : 'disabled'}`)
  if (result.tables?.length) {
    for (const t of result.tables) {
      const docs = (t.stats as any)?.num_docs ?? '?'
      const healthTag = t.healthy === false ? ' [unhealthy]'
        : t.indexHealth?.some(i => i.walBacklog > 0) ? ' [enriching]'
        : ''
      console.log(`  ${t.table} (${t.pluginId}): ${docs} docs${healthTag}`)
      if (t.healthy === false && t.indexHealth) {
        for (const idx of t.indexHealth) {
          if (idx.error) console.log(`    ${idx.name}: ERROR — ${idx.error}`)
        }
      }
    }
  }
}

type CliDoctorResult = {
  results: Array<{ check: string; status: string; message: string }>
  summary: { total: number; errors: number; warnings: number }
  mode?: 'offline' | 'full'
}

type CliDoctorRepairChange = {
  kind: string
  target: string
  action: string
  description: string
}

type CliDoctorRepairPlanItem = {
  id: string
  checkId: string
  healthCheckId?: string
  pluginId?: string
  checkName?: string
  title: string
  reason: string
  safety: 'safe' | 'manual' | 'destructive'
  requiresConfirmation: boolean
  changes: CliDoctorRepairChange[]
}

type CliDoctorRepairPlan = {
  diagnostics: Array<{ check: string; status: string; message: string; autoFixable?: boolean }>
  items: CliDoctorRepairPlanItem[]
  errors: Array<{ phase: string; healthCheckId: string; message: string }>
  summary: {
    diagnostics: number
    repairableChecks: number
    totalItems: number
    safeItems: number
    blockedItems: number
    planErrors: number
  }
}

type CliDoctorRepairApply = {
  status: 'confirmation_required' | 'applied'
  plan: CliDoctorRepairPlan
  applied: Array<{ id: string; checkId: string; status: string; message: string; changes: CliDoctorRepairChange[] }>
  skipped: Array<{ id: string; checkId: string; status: string; message: string; changes: CliDoctorRepairChange[] }>
  errors: Array<{ phase: string; healthCheckId: string; message: string }>
  verification: Array<{ check: string; status: string; message: string; autoFixable?: boolean }>
  summary: {
    planned: number
    applied: number
    skipped: number
    failed: number
    verificationErrors: number
    verificationWarnings: number
  }
}

type CliDoctorDelegateReport = {
  status: 'confirmation_required' | 'sent' | 'no_unresolved'
  request: Record<string, unknown>
  unresolved: Array<{ check: string; status: string; message: string; autoFixable?: boolean }>
}

function summarizeDoctorResults(results: CliDoctorResult['results']): CliDoctorResult['summary'] {
  return {
    total: results.length,
    errors: results.filter(r => r.status === 'error').length,
    warnings: results.filter(r => r.status === 'warn').length,
  }
}

async function runOfflineDoctor(): Promise<CliDoctorResult> {
  const [
    { mkdirComponent },
    { settingsComponent },
    { searchComponent },
    { searchModelsComponent },
    { mcporterComponent },
    { agentAssetsComponent },
    { recommendedPluginsComponent },
  ] = await Promise.all([
    import('../src/core/onboarding/mkdir'),
    import('../src/core/onboarding/settings'),
    import('../src/core/onboarding/search'),
    import('../src/core/onboarding/search-models'),
    import('../src/core/onboarding/mcporter'),
    import('../src/core/onboarding/agent-assets'),
    import('../src/core/onboarding/recommended-plugins'),
  ])
  const checks = []
  for (const component of [
    mkdirComponent,
    settingsComponent,
    searchComponent,
    searchModelsComponent,
    mcporterComponent,
    agentAssetsComponent,
    recommendedPluginsComponent,
  ]) {
    try {
      checks.push(await component.check())
    } catch (err) {
      checks.push({
        name: component.name,
        status: 'error' as const,
        message: `check() threw: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }
  const results: CliDoctorResult['results'] = checks.map(check => ({
    check: check.name,
    status: check.status === 'ok' ? 'ok' : check.status === 'warn' ? 'warn' : 'error',
    message: check.remediation ? `${check.message} ${check.remediation}` : check.message,
  }))
  results.push({
    check: 'runtime',
    status: 'warn',
    message: 'Skipped live runtime checks in offline mode. Run `bakin doctor --full` after `bakin start` to verify runtime reachability, agents, LLM providers, and channels.',
  })
  results.push({
    check: 'plugin-assets',
    status: 'warn',
    message: 'Skipped runtime skill projection checks in offline mode. Run `bakin doctor --full` after `bakin start` to verify plugin assets.',
  })
  results.push({
    check: 'server-backed-checks',
    status: 'warn',
    message: 'Skipped plugin, search index, workflow, task, and server health checks that require the Bakin server. Run `bakin doctor --full` after `bakin start`.',
  })
  return { results, summary: summarizeDoctorResults(results), mode: 'offline' }
}

async function runFullDoctor(options: { notifyAgent: boolean }): Promise<CliDoctorResult> {
  const query = options.notifyAgent
    ? '/api/plugins/health/doctor?fresh=true&notifyAgent=true'
    : '/api/plugins/health/doctor?fresh=true'
  const result = await apiGet(query) as CliDoctorResult
  return { ...result, mode: 'full' }
}

async function runDoctorRepairPlan(): Promise<CliDoctorRepairPlan> {
  return await apiGet('/api/plugins/health/doctor/repair/plan') as CliDoctorRepairPlan
}

async function runDoctorRepairApply(): Promise<CliDoctorRepairApply> {
  return await apiPost('/api/plugins/health/doctor/repair/apply', { accepted: true }) as CliDoctorRepairApply
}

async function runDoctorDelegateApply(): Promise<CliDoctorDelegateReport> {
  return await apiPost('/api/plugins/health/doctor/delegate', { accepted: true }) as CliDoctorDelegateReport
}

function doctorRepairExitCode(report: CliDoctorRepairApply): 0 | 1 | 2 {
  if (report.summary.failed > 0 || report.summary.verificationErrors > 0 || report.errors.length > 0) return 1
  if (report.summary.verificationWarnings > 0) return 2
  return 0
}

function printDoctorRepairJson(data: unknown, exitCode: 0 | 1 | 2, error: { code: string; message: string } | null = null): void {
  console.log(JSON.stringify({
    ok: error === null && exitCode !== 1,
    command: 'doctor --fix',
    exitCode,
    data,
    error,
  }, null, 2))
}

function printDoctorRepairPlan(plan: CliDoctorRepairPlan): void {
  console.log('Doctor repair plan')
  console.log(`${plan.summary.safeItems} safe, ${plan.summary.blockedItems} blocked, ${plan.summary.planErrors} plan errors`)
  if (plan.items.length === 0) {
    console.log('No deterministic repairs available.')
    return
  }
  for (const item of plan.items) {
    console.log(`\n[${item.safety.toUpperCase()}] ${item.title}`)
    console.log(`  id: ${item.id}`)
    console.log(`  reason: ${item.reason}`)
    for (const change of item.changes) {
      console.log(`  - ${change.action} ${change.target}: ${change.description}`)
    }
  }
}

function printDoctorRepairApply(report: CliDoctorRepairApply): void {
  console.log('Doctor repair results')
  for (const result of report.applied) {
    const label = result.status === 'applied' ? 'APPLIED' : result.status.toUpperCase()
    console.log(`[${label}] ${result.id}: ${result.message}`)
  }
  for (const result of report.skipped) {
    console.log(`[SKIPPED] ${result.id}: ${result.message}`)
  }
  console.log(`\n${report.summary.applied} applied, ${report.summary.skipped} skipped, ${report.summary.failed} failed`)
  if (report.verification.length > 0) {
    console.log(`${report.summary.verificationErrors} verification errors, ${report.summary.verificationWarnings} verification warnings`)
  }
}

function unresolvedDelegateRows(plan: CliDoctorRepairPlan): CliDoctorRepairPlan['diagnostics'] {
  const safeRepairChecks = new Set(
    plan.items
      .filter(item => item.safety === 'safe')
      .map(item => item.checkId),
  )
  return plan.diagnostics.filter(row => (
    (row.status === 'warn' || row.status === 'error')
    && !safeRepairChecks.has(row.check)
  ))
}

function printDoctorDelegatePreview(plan: CliDoctorRepairPlan, unresolved: CliDoctorRepairPlan['diagnostics']): void {
  console.log('Doctor delegated repair preview')
  if (unresolved.length === 0) {
    console.log('No unresolved findings need delegated repair.')
    return
  }
  for (const row of unresolved) {
    console.log(`[${row.status.toUpperCase()}] ${row.check}: ${row.message}`)
  }
}

function printDoctorDelegateResult(report: CliDoctorDelegateReport): void {
  if (report.status === 'no_unresolved') {
    console.log('No unresolved findings need delegated repair.')
    return
  }
  const request = report.request as { id?: string; taskId?: string; agentId?: string }
  console.log(`Delegated doctor repair ${request.id ?? ''}`)
  if (request.taskId) console.log(`Task: ${request.taskId}`)
  if (request.agentId) console.log(`Agent: ${request.agentId}`)
}

async function printDoctorRepairPlanTui(plan: CliDoctorRepairPlan): Promise<void> {
  const [{ DoctorRepairPlan }, { renderToString }, { createElement }] = await Promise.all([
    import('../src/core/cli/ui/doctor-repair'),
    import('ink'),
    import('react'),
  ])
  console.log(renderToString(createElement(DoctorRepairPlan, { plan })))
}

async function printDoctorRepairApplyTui(report: CliDoctorRepairApply, opts: { showBrand?: boolean } = {}): Promise<void> {
  const [{ DoctorRepairApplyReport }, { renderToString }, { createElement }] = await Promise.all([
    import('../src/core/cli/ui/doctor-repair'),
    import('ink'),
    import('react'),
  ])
  console.log(renderToString(createElement(DoctorRepairApplyReport, { report, showBrand: opts.showBrand })))
}

async function printDoctorDelegatePreviewTui(unresolved: CliDoctorRepairPlan['diagnostics']): Promise<void> {
  const [{ DoctorDelegatePreview }, { renderToString }, { createElement }] = await Promise.all([
    import('../src/core/cli/ui/doctor-repair'),
    import('ink'),
    import('react'),
  ])
  console.log(renderToString(createElement(DoctorDelegatePreview, { unresolved })))
}

async function printDoctorDelegateResultTui(report: CliDoctorDelegateReport, opts: { showBrand?: boolean } = {}): Promise<void> {
  const [{ DoctorDelegateResult }, { renderToString }, { createElement }] = await Promise.all([
    import('../src/core/cli/ui/doctor-repair'),
    import('ink'),
    import('react'),
  ])
  console.log(renderToString(createElement(DoctorDelegateResult, { report, showBrand: opts.showBrand })))
}

async function confirmDoctorRepair(plan: CliDoctorRepairPlan): Promise<boolean> {
  if (plan.summary.safeItems === 0) return false
  const readline = await import('node:readline/promises')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`\nApply ${plan.summary.safeItems} safe repair item${plan.summary.safeItems === 1 ? '' : 's'}? [y/N] `)
    return /^(y|yes)$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

async function confirmDoctorDelegate(unresolved: CliDoctorRepairPlan['diagnostics']): Promise<boolean> {
  if (unresolved.length === 0) return false
  const readline = await import('node:readline/promises')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`\nCreate a delegated repair task for ${unresolved.length} finding${unresolved.length === 1 ? '' : 's'}? [y/N] `)
    return /^(y|yes)$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

async function cmdDoctorFix(options: { json: boolean; yes: boolean; isTTY: boolean }): Promise<void> {
  let acceptedInteractively = false
  if (!options.yes) {
    const plan = await runDoctorRepairPlan()
    if (options.json) {
      if (plan.summary.totalItems === 0) {
        printDoctorRepairJson({ status: 'planned', plan }, 0)
        return
      }
      printDoctorRepairJson(
        { status: 'confirmation_required', plan },
        1,
        { code: 'CONFIRMATION_REQUIRED', message: 'Run `bakin doctor --fix --yes` to apply safe deterministic repairs.' },
      )
      process.exit(1)
    }

    if (options.isTTY) {
      await printDoctorRepairPlanTui(plan)
    } else {
      printDoctorRepairPlan(plan)
    }
    if (plan.summary.totalItems === 0) return

    if (!options.isTTY) {
      console.log('\nRun `bakin doctor --fix --yes` to apply safe deterministic repairs.')
      process.exit(1)
    }
    const accepted = await confirmDoctorRepair(plan)
    if (!accepted) {
      console.log('Repair cancelled.')
      process.exit(1)
    }
    acceptedInteractively = true
  }

  const report = await runDoctorRepairApply()
  const exitCode = doctorRepairExitCode(report)
  if (options.json) {
    printDoctorRepairJson(report, exitCode, exitCode === 1
      ? { code: 'DOCTOR_REPAIR_FAILED', message: 'One or more deterministic doctor repairs failed or did not verify.' }
      : null)
    if (exitCode !== 0) process.exit(exitCode)
    return
  }
  if (options.isTTY) {
    if (acceptedInteractively) console.log('')
    await printDoctorRepairApplyTui(report, { showBrand: !acceptedInteractively })
  } else {
    printDoctorRepairApply(report)
  }
  if (exitCode !== 0) process.exit(exitCode)
}

async function cmdDoctorDelegate(options: { json: boolean; yes: boolean; isTTY: boolean }): Promise<void> {
  let acceptedInteractively = false
  if (!options.yes) {
    const plan = await runDoctorRepairPlan()
    const unresolved = unresolvedDelegateRows(plan)
    if (options.json) {
      if (unresolved.length === 0) {
        printDoctorRepairJson({ status: 'no_unresolved', plan, unresolved }, 0)
        return
      }
      printDoctorRepairJson(
        { status: 'confirmation_required', plan, unresolved },
        1,
        { code: 'CONFIRMATION_REQUIRED', message: 'Run `bakin doctor --delegate --yes` to create the delegated repair task.' },
      )
      process.exit(1)
    }

    if (options.isTTY) {
      await printDoctorDelegatePreviewTui(unresolved)
    } else {
      printDoctorDelegatePreview(plan, unresolved)
    }
    if (unresolved.length === 0) return
    if (!options.isTTY) {
      console.log('\nRun `bakin doctor --delegate --yes` to create the delegated repair task.')
      process.exit(1)
    }
    const accepted = await confirmDoctorDelegate(unresolved)
    if (!accepted) {
      console.log('Delegated repair cancelled.')
      process.exit(1)
    }
    acceptedInteractively = true
  }

  const report = await runDoctorDelegateApply()
  if (options.json) {
    printDoctorRepairJson(report, 0)
    return
  }
  if (options.isTTY) {
    if (acceptedInteractively) console.log('')
    await printDoctorDelegateResultTui(report, { showBrand: !acceptedInteractively })
  } else {
    printDoctorDelegateResult(report)
  }
}

async function cmdDoctorRepair(args: string[], options: { json: boolean }): Promise<void> {
  const sub = args[1] ?? 'list'
  if (sub === 'list') {
    const result = await apiGet('/api/plugins/health/doctor/repair') as { requests?: Array<Record<string, unknown>> }
    if (options.json) {
      printDoctorRepairJson(result, 0)
      return
    }
    const requests = result.requests ?? []
    if (requests.length === 0) {
      console.log('No doctor repair requests.')
      return
    }
    for (const request of requests) {
      console.log(`${request.id ?? '(unknown)'}  ${request.status ?? 'unknown'}  task=${request.taskId ?? '-'}`)
    }
    return
  }

  const requestId = args[2]
  if (!requestId) {
    console.error(`Usage: bakin doctor repair ${sub} <request-id>`)
    process.exit(1)
  }

  if (sub === 'show') {
    const result = await apiGet(`/api/plugins/health/doctor/repair/${encodeURIComponent(requestId)}`)
    if (options.json) {
      printDoctorRepairJson(result, 0)
      return
    }
    print(result)
    return
  }

  if (sub === 'verify') {
    const result = await apiPost(`/api/plugins/health/doctor/repair/${encodeURIComponent(requestId)}/verify`)
    if (options.json) {
      printDoctorRepairJson(result, 0)
      return
    }
    print(result)
    return
  }

  console.error(`Unknown doctor repair subcommand: ${sub}`)
  process.exit(1)
}

async function cmdDoctor(args: string[] = process.argv.slice(2)): Promise<void> {
  const json = args.includes('--json')
  const full = args.includes('--full')
  const notifyAgent = args.includes('--notify-agent')
  const fix = args.includes('--fix')
  const delegate = args.includes('--delegate')
  const yes = args.includes('--yes')
  const isTTY = Boolean(process.stdout.isTTY)
  if (args[0] === 'repair') {
    await cmdDoctorRepair(args, { json })
    return
  }
  if (fix) {
    await cmdDoctorFix({ json, yes, isTTY })
    return
  }
  if (delegate) {
    await cmdDoctorDelegate({ json, yes, isTTY })
    return
  }
  const result = full ? await runFullDoctor({ notifyAgent }) : await runOfflineDoctor()

  if (json) {
    console.log(JSON.stringify({
      ok: result.summary.errors === 0,
      command: 'doctor',
      exitCode: result.summary.errors > 0 ? 1 : result.summary.warnings > 0 ? 2 : 0,
      data: result,
      error: result.summary.errors > 0
        ? { code: 'DOCTOR_ERRORS', message: `${result.summary.errors} doctor check${result.summary.errors === 1 ? '' : 's'} failed` }
        : null,
    }, null, 2))
    if (result.summary.errors > 0) process.exit(1)
    if (result.summary.warnings > 0) process.exit(2)
    return
  }

  if (isTTY) {
    const { DoctorReport } = await import('../src/core/cli/ui/doctor')
    const { renderToString } = await import('ink')
    const { createElement } = await import('react')
    console.log(renderToString(createElement(DoctorReport, {
      results: result.results,
      summary: result.summary,
      mode: result.mode,
    })))
    if (result.summary.errors > 0) process.exit(1)
    if (result.summary.warnings > 0) process.exit(2)
    return
  }

  const statusIcon: Record<string, string> = { ok: 'OK', warn: 'WARN', error: 'FAIL', fixed: 'FIXED' }

  for (const r of result.results) {
    const icon = statusIcon[r.status] || r.status
    console.log(`  [${icon}] ${r.check}: ${r.message}`)
  }

  console.log('')
  const { total, errors, warnings } = result.summary
  if (errors > 0) {
    console.log(`${errors} errors, ${warnings} warnings out of ${total} checks`)
  } else if (warnings > 0) {
    console.log(`${warnings} warnings out of ${total} checks`)
  } else {
    console.log(`All ${total} checks passed`)
  }
  if (errors > 0) process.exit(1)
  if (warnings > 0) process.exit(2)
}

// ---------------------------------------------------------------------------
// Agent Rules
// ---------------------------------------------------------------------------

// Agent-rules context management is owned by src/core/agent-rules/managed-blocks.ts.
// Imported lazily inside cmdAgentRules so the CLI stays a pure entry point.

async function cmdAgentRules(options: { apply?: boolean; check?: boolean; applyAll?: boolean; checkAll?: boolean } = {}): Promise<void> {
  if (!options.apply && !options.check && !options.applyAll && !options.checkAll) {
    console.log('Usage: bakin agent-rules --apply       # Write main-agent managed context to AGENTS.md')
    console.log('       bakin agent-rules --check       # Check if main-agent managed context is current')
    console.log('       bakin agent-rules --apply-all   # Apply managed context to all agent AGENTS.md files')
    console.log('       bakin agent-rules --check-all   # Check managed context across all agents')
    return
  }

  const { applyManagedBlocks } = await import('../src/core/agent-rules/managed-blocks')
  const scope = options.apply || options.check ? 'orchestrator' : 'all'
  const autoFix = !!(options.apply || options.applyAll)
  const results = await applyManagedBlocks(autoFix, { scope })
  const errors = results.filter(r => r.status === 'error')
  const warnings = results.filter(r => r.status === 'warn')
  const fixes = results.filter(r => r.status === 'fixed')
  const oks = results.filter(r => r.status === 'ok')

  for (const r of results) {
    const icon = r.status === 'ok' ? '[OK]' : r.status === 'fixed' ? '[FIXED]' : r.status === 'warn' ? '[WARN]' : '[ERROR]'
    console.log(`${icon} ${r.check}: ${r.message}`)
  }

  console.log(`\n${oks.length} up to date, ${fixes.length} fixed, ${warnings.length} warnings, ${errors.length} errors`)
  if (errors.length > 0 || warnings.length > 0) process.exit(1)
}

async function cmdPaths(key?: string): Promise<void> {
  const result = await apiGet(`/api/paths${key ? `?key=${encodeURIComponent(key)}` : ''}`) as Record<string, unknown>

  if (key) {
    // Single path — print just the value (useful for scripting: bakin paths assets)
    console.log(result.path)
  } else {
    const paths = result.paths as Record<string, string>
    const isHome = result.isBakinHome ? '~/.bakin' : './content (not migrated)'
    console.log(`Content dir: ${isHome}`)
    console.log('')
    for (const [k, v] of Object.entries(paths)) {
      console.log(`  ${k.padEnd(12)} ${v}`)
    }
  }
}

const SERVICE_LABEL = 'com.makinbakin.bakin'
const LEGACY_SERVICE_LABELS = ['com.bakin.mc']

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function systemdEscape(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

async function serviceProgramArgs(): Promise<string[]> {
  const { existsSync } = await import('fs')
  const { join, resolve, dirname } = await import('path')
  const argvScript = process.argv[1]
  if (argvScript && existsSync(argvScript) && /\.(ts|js|mjs|cjs)$/.test(argvScript)) {
    const projectDir = resolve(dirname(new URL(import.meta.url).pathname), '..')
    const serverPath = join(projectDir, 'server.ts')
    if (existsSync(serverPath)) return [process.execPath, serverPath, 'serve']
    return [process.execPath, argvScript, 'serve']
  }
  return [argvScript || process.execPath, 'serve']
}

function generateLaunchAgentPlist(opts: {
  programArgs: string[]
  workingDir: string
  stdoutPath: string
  stderrPath: string
}): string {
  const args = opts.programArgs.map(arg => `    <string>${xmlEscape(arg)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(opts.workingDir)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(opts.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(opts.stderrPath)}</string>
</dict>
</plist>
`
}

function generateSystemdUnit(opts: {
  programArgs: string[]
  workingDir: string
  stdoutPath: string
  stderrPath: string
}): string {
  return `[Unit]
Description=Bakin server
After=network.target

[Service]
Type=simple
WorkingDirectory=${systemdEscape(opts.workingDir)}
ExecStart=${opts.programArgs.map(systemdEscape).join(' ')}
Restart=on-failure
RestartSec=3
Environment=PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
StandardOutput=append:${opts.stdoutPath}
StandardError=append:${opts.stderrPath}

[Install]
WantedBy=default.target
`
}

function serverProcessPattern(): string {
  return 'tsx.*server\\.ts|bakin.*serve'
}

async function cmdSetupService(options: { uninstall?: boolean } = {}): Promise<void> {
  const { execFileSync } = await import('child_process')
  const { existsSync, mkdirSync, unlinkSync, writeFileSync } = await import('fs')
  const { join, dirname, resolve } = await import('path')
  const { homedir } = await import('os')
  const { getBakinPaths } = await import('../packages/core/src/content-dir')

  const programArgs = await serviceProgramArgs()
  const projectDir = resolve(dirname(new URL(import.meta.url).pathname), '..')
  const paths = getBakinPaths()
  const stdoutPath = join(paths.logs, 'server.out.log')
  const stderrPath = join(paths.logs, 'server.err.log')
  mkdirSync(paths.logs, { recursive: true })

  if (process.platform === 'darwin') {
    const launchAgentsDir = join(homedir(), 'Library', 'LaunchAgents')
    const plistPath = join(launchAgentsDir, `${SERVICE_LABEL}.plist`)
    const uid = execFileSync('id', ['-u'], { encoding: 'utf-8' }).trim()
    const removePlist = (path: string) => {
      try { execFileSync('launchctl', ['bootout', `gui/${uid}`, path], { stdio: 'pipe' }) } catch { /* not loaded */ }
      if (existsSync(path)) unlinkSync(path)
    }

    if (options.uninstall) {
      console.log('[..] Removing Bakin LaunchAgent...')
      removePlist(plistPath)
      for (const label of LEGACY_SERVICE_LABELS) {
        removePlist(join(launchAgentsDir, `${label}.plist`))
      }
      console.log('[OK] Bakin autostart disabled')
      return
    }

    mkdirSync(launchAgentsDir, { recursive: true })
    removePlist(plistPath)
    for (const label of LEGACY_SERVICE_LABELS) {
      removePlist(join(launchAgentsDir, `${label}.plist`))
    }
    writeFileSync(plistPath, generateLaunchAgentPlist({
      programArgs,
      workingDir: projectDir,
      stdoutPath,
      stderrPath,
    }), 'utf-8')
    execFileSync('launchctl', ['bootstrap', `gui/${uid}`, plistPath], { stdio: 'pipe' })
    execFileSync('launchctl', ['kickstart', '-k', `gui/${uid}/${SERVICE_LABEL}`], { stdio: 'pipe' })
    console.log('[OK] Bakin autostart enabled')
    console.log(`  Service: ${SERVICE_LABEL}`)
    console.log(`  Logs:    ${stdoutPath}`)
    console.log('  Disable: bakin setup service --uninstall')
    return
  }

  if (process.platform === 'linux') {
    const systemdDir = join(homedir(), '.config', 'systemd', 'user')
    const unitPath = join(systemdDir, `${SERVICE_LABEL}.service`)
    if (options.uninstall) {
      console.log('[..] Removing Bakin user service...')
      try { execFileSync('systemctl', ['--user', 'disable', '--now', `${SERVICE_LABEL}.service`], { stdio: 'pipe' }) } catch { /* not enabled */ }
      if (existsSync(unitPath)) unlinkSync(unitPath)
      try { execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' }) } catch { /* systemd unavailable */ }
      console.log('[OK] Bakin autostart disabled')
      return
    }

    mkdirSync(systemdDir, { recursive: true })
    writeFileSync(unitPath, generateSystemdUnit({
      programArgs,
      workingDir: projectDir,
      stdoutPath,
      stderrPath,
    }), 'utf-8')
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' })
    execFileSync('systemctl', ['--user', 'enable', '--now', `${SERVICE_LABEL}.service`], { stdio: 'pipe' })
    console.log('[OK] Bakin autostart enabled')
    console.log(`  Service: ${SERVICE_LABEL}.service`)
    console.log(`  Logs:    ${stdoutPath}`)
    console.log('  Disable: bakin setup service --uninstall')
    return
  }

  console.error(`Service management is not supported on ${process.platform}.`)
  process.exit(1)
}

async function cmdReboot(): Promise<void> {
  const { execFileSync } = await import('child_process')
  const { join, resolve, dirname } = await import('path')

  // --- launchctl restart path commented out — manual process management only ---
  // const { existsSync } = await import('fs')
  // const { homedir } = await import('os')
  // const uid = execSync('id -u', { encoding: 'utf-8' }).trim()
  // const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`)
  // const isService = existsSync(plistPath)
  //
  // if (isService) {
  //   console.log('[..] Restarting Bakin via launchctl...')
  //   try {
  //     execSync(`launchctl kickstart -k gui/${uid}/${SERVICE_LABEL}`, { stdio: 'pipe' })
  //     console.log('[OK] Bakin restarting')
  //   } catch {
  //     console.log('[..] Kickstart failed, trying bootout + bootstrap...')
  //     try { execSync(`launchctl bootout gui/${uid} ${plistPath}`, { stdio: 'pipe' }) } catch { /* ok */ }
  //     await new Promise(r => setTimeout(r, 1000))
  //     try {
  //       execSync(`launchctl bootstrap gui/${uid} ${plistPath}`, { stdio: 'pipe' })
  //       console.log('[OK] Bakin restarting')
  //     } catch (err) {
  //       console.error('[FAIL] Could not restart:', err instanceof Error ? err.message : String(err))
  //       process.exit(1)
  //     }
  //   }
  // } else {

  // Kill any running Bakin server processes
  console.log('[..] Stopping Bakin server...')
  try {
    const pids = execFileSync('pgrep', ['-f', serverProcessPattern()], { encoding: 'utf-8' }).trim()
    if (pids) {
      for (const pid of pids.split('\n')) {
        if (pid && pid !== String(process.pid)) {
          process.kill(Number(pid), 'SIGTERM')
        }
      }
      console.log('[OK] Sent SIGTERM to Bakin server')
      console.log('[..] Waiting for shutdown...')
      await new Promise(r => setTimeout(r, 2000))
    }
  } catch {
    console.log('[..] No running Bakin process found')
  }

  // Start the server in background
  const projectDir = resolve(dirname(new URL(import.meta.url).pathname), '..')
  const logPath = join(projectDir, 'mc-server.log')

  console.log('[..] Starting Bakin server...')
  const { spawn } = await import('child_process')
  const programArgs = await serviceProgramArgs()
  const child = spawn(programArgs[0], programArgs.slice(1), {
    cwd: projectDir,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env },
  })
  child.unref()
  console.log(`[OK] Bakin starting (pid ${child.pid})`)
  console.log(`  Logs: tail -f ${logPath}`)

  // } // end of else branch for non-service path

  // Wait and verify
  console.log('[..] Waiting for server to come up...')
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000))
    try {
      const res = await fetch(`${BASE_URL}/api/version`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) {
        const data = await res.json() as { version: string }
        console.log(`[OK] Bakin is up (${data.version})`)
        return
      }
    } catch { /* not ready yet */ }
  }
  console.log('[WARN] Server not responding after 15s — check logs')
}

async function cmdReindex(options: { table?: string; rebuild?: boolean } = {}): Promise<void> {
  let url = '/api/reindex'
  const params: string[] = []
  if (options.table) params.push(`table=${encodeURIComponent(options.table)}`)
  if (options.rebuild) params.push('rebuild=true')
  if (params.length) url += `?${params.join('&')}`

  console.log(`Reindexing ${options.table || 'all content'} into search${options.rebuild ? ' (rebuild indexes)' : ''}...`)
  const result = await apiPost(url) as {
    ok: boolean
    total: number
    errors: number
    enrichmentErrors?: number
    tables: Array<{
      table: string
      indexed: number
      error?: string
      enrichment?: { healthy: boolean; indexes: Array<{ name: string; error?: string; walBacklog: number }> }
    }>
  }
  if (result.tables?.length) {
    for (const t of result.tables) {
      if (t.error) {
        console.log(`  ${t.table}: ERROR — ${t.error}`)
      } else {
        const enrichTag = t.enrichment
          ? t.enrichment.healthy ? '' : ' [enrichment unhealthy]'
          : ''
        console.log(`  ${t.table}: ${t.indexed} documents${enrichTag}`)
      }
    }
  }
  console.log(`Done. ${result.total} total documents indexed.`)
  if ((result.enrichmentErrors ?? 0) > 0) {
    console.log(`WARNING: ${result.enrichmentErrors} table(s) have enrichment errors — check health page for details.`)
  }
}

async function cmdLogs(filter?: string): Promise<void> {
  const { spawn, execSync } = await import('child_process')
  const { existsSync } = await import('fs')
  const { getBakinPaths } = await import('../packages/core/src/content-dir')
  const auditPath = getBakinPaths().audit

  if (!existsSync(auditPath)) {
    console.error(`Audit log not found: ${auditPath}`)
    console.error('Is Bakin initialized? Run: bakin mkdir')
    process.exit(1)
  }

  // Build jq filter
  let jqFilter = '{ts,event,agent,channel,data}'
  if (filter === 'mcp') jqFilter = 'select(.channel=="mcp") | {ts,event,agent,data}'
  else if (filter === 'rest') jqFilter = 'select(.channel=="rest") | {ts,event,agent,data}'
  else if (filter) jqFilter = `select(.agent=="${filter}" or .channel=="${filter}") | {ts,event,agent,channel,data}`

  // Show last 20 entries first so there's immediate output
  console.log(`Tailing ${auditPath} (filter: ${filter || 'all'})`)
  console.log('--- recent entries ---')
  try {
    execSync(`tail -20 "${auditPath}" | jq '${jqFilter}'`, { stdio: ['ignore', 'inherit', 'ignore'] })
  } catch { /* filter may exclude all 20 lines — that's fine */ }
  console.log('--- live tail (Ctrl-C to stop) ---\n')

  // Now tail -f for new entries (start from end, 0 lines of history to avoid dupes)
  const child = spawn('tail', ['-f', '-n', '0', auditPath], { stdio: ['ignore', 'pipe', 'inherit'] })
  const jq = spawn('jq', ['--unbuffered', jqFilter], { stdio: ['pipe', 'inherit', 'inherit'] })

  child.stdout.pipe(jq.stdin)

  // Clean up on exit
  process.on('SIGINT', () => {
    child.kill()
    jq.kill()
    process.exit(0)
  })

  await new Promise(() => {}) // block until killed
}

async function cmdStop(): Promise<void> {
  const { execFileSync } = await import('child_process')

  console.log('[..] Stopping Bakin server...')
  try {
    const pids = execFileSync('pgrep', ['-f', serverProcessPattern()], { encoding: 'utf-8' }).trim()
    if (pids) {
      for (const pid of pids.split('\n')) {
        if (pid && pid !== String(process.pid)) {
          process.kill(Number(pid), 'SIGTERM')
        }
      }
      console.log('[OK] Sent SIGTERM to Bakin server')

      // Wait and verify it's actually down
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 500))
        try {
          await fetch(`${BASE_URL}/api/version`, { signal: AbortSignal.timeout(1000) })
        } catch {
          console.log('[OK] Bakin stopped')
          return
        }
      }
      console.log('[WARN] Server may still be shutting down')
    } else {
      console.log('[OK] No running Bakin process found')
    }
  } catch {
    console.log('[OK] No running Bakin process found')
  }
}

// ---------------------------------------------------------------------------
// CLI router
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// New commands for MCP tool parity
// ---------------------------------------------------------------------------

async function cmdTasksLog(id: string, message: string): Promise<void> {
  const result = await apiPost(`/api/plugins/tasks/${id}/log`, { id, author: await getCliAgent(), message })
  print(result)
}

async function cmdTasksBlock(id: string, reason: string): Promise<void> {
  const result = await apiPost(`/api/plugins/tasks/${id}/block`, { id, reason, agent: await getCliAgent() })
  print(result)
}

async function cmdTasksDepend(id: string, dependsOn: string): Promise<void> {
  const result = await apiPost(`/api/plugins/tasks/${id}/dependency`, { id, dependsOn })
  print(result)
}

async function cmdTasksComplete(id: string, summary: string): Promise<void> {
  const agent = await getCliAgent()
  // Log the summary, then move to done
  await apiPost(`/api/plugins/tasks/${id}/log`, { id, author: agent, message: `Task complete: ${summary}` })
  const result = await apiPost(`/api/plugins/tasks/${id}/move`, { id, to: 'done', agent })
  print(result)
}

async function cmdTasksGet(id: string): Promise<void> {
  const result = await apiGet('/api/plugins/tasks/') as { columns: Record<string, Array<Record<string, unknown>>> }
  const columns = result.columns || {}
  for (const [colName, tasks] of Object.entries(columns)) {
    const task = (tasks as Array<Record<string, unknown>>).find(t => t.id === id)
    if (task) {
      if (process.stdout.isTTY) {
        await printTaskDetailTui(id, colName, task)
        return
      }
      console.log(`Column: ${colName}`)
      print(task)
      return
    }
  }
  console.error(`Task ${id} not found`)
  process.exit(1)
}

async function cmdWorkflowsList(): Promise<void> {
  const result = await apiGet('/api/plugins/workflows/definitions') as { templates?: Array<Record<string, unknown>> }
  const templates = result?.templates || []
  if (process.stdout.isTTY) {
    await printWorkflowsListTui(templates)
    return
  }
  if (templates.length === 0) {
    console.log('No workflow definitions found.')
    return
  }
  printTable(templates, ['filename', 'name', 'description', 'stepCount'])
}

async function cmdWorkflowsStart(taskId: string, workflowId: string): Promise<void> {
  const result = await apiPost('/api/plugins/workflows/instances/start', { taskId, workflowId })
  print(result)
}

async function cmdWorkflowsStep(taskId: string): Promise<void> {
  const result = await apiGet(`/api/plugins/workflows/steps/${encodeURIComponent(taskId)}`)
  print(result)
}

async function cmdWorkflowsSubmit(taskId: string, stepId: string, outputJson: string): Promise<void> {
  let output: Record<string, unknown>
  try {
    output = JSON.parse(outputJson)
  } catch {
    console.error('Invalid JSON for output. Usage: bakin workflows submit <taskId> <stepId> \'{"key":"value"}\'')
    process.exit(1)
  }
  const result = await apiPost(`/api/plugins/workflows/steps/${encodeURIComponent(taskId)}/complete`, { stepId, agentId: await getCliAgent(), output })
  print(result)
}

// ---------------------------------------------------------------------------
// Trash commands
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function daysUntil(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now()
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'expiring'
  return `${days}d`
}

async function cmdTrashList(): Promise<void> {
  const data = await apiGet('/api/plugins/assets/trash') as { assets: Array<{ filename: string; originalFilename: string; type: string; size: number; deletedAt: string; expiresAt: string; metadata: { agent?: string } | null }>; count: number }
  if (process.stdout.isTTY) {
    await printTrashListTui(data.assets as Array<Record<string, unknown>>)
    return
  }
  if (data.count === 0) {
    console.log('Trash is empty.')
    return
  }
  console.log(`${data.count} item${data.count !== 1 ? 's' : ''} in trash:\n`)
  const rows = data.assets.map(a => ({
    filename: a.originalFilename,
    type: a.type,
    size: formatBytes(a.size),
    deleted: new Date(a.deletedAt).toLocaleString(),
    expires: daysUntil(a.expiresAt),
    agent: a.metadata?.agent ?? 'unknown',
    trashName: a.filename,
  }))
  printTable(rows, ['filename', 'type', 'size', 'deleted', 'expires', 'agent'])
  console.log(`\nTo restore: bakin trash restore <trashName>`)
  console.log('Use the full trash filename (with __deleted- suffix) from the list above.')
}

async function cmdTrashRestore(filename: string): Promise<void> {
  const data = await apiPost(`/api/plugins/assets/trash/${encodeURIComponent(filename)}/restore`) as { ok: boolean; restoredPath: string }
  console.log(`Restored → ${data.restoredPath}`)
}

async function cmdTrashEmpty(): Promise<void> {
  const check = await apiGet('/api/plugins/assets/trash') as { count: number }
  if (check.count === 0) {
    console.log('Trash is already empty.')
    return
  }
  const data = await apiDelete('/api/plugins/assets/trash') as { ok: boolean; deleted: number }
  console.log(`Permanently deleted ${data.deleted} item${data.deleted !== 1 ? 's' : ''}.`)
}

// ---------------------------------------------------------------------------
// Plugin-contributed CLI commands
// ---------------------------------------------------------------------------

interface PluginCliCommand {
  name: string
  usage: string
  summary: string
  aliases?: string[]
  dispatch?: {
    type: 'execTool'
    name: string
  } | {
    type: 'apiRoute'
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    path: string
  }
}

interface PluginManifestRow {
  id: string
  contributes?: {
    cliCommands?: PluginCliCommand[]
  }
}

function parsePluginCliValue(value: string): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if (value.startsWith('[') || value.startsWith('{')) {
    try { return JSON.parse(value) } catch { return value }
  }
  if (value.includes(',') && !value.includes(' ')) {
    return value.split(',').filter(Boolean)
  }
  return value
}

function parsePluginCliArgs(args: string[]): { flags: Record<string, unknown>; positionals: string[] } {
  const flags: Record<string, unknown> = {}
  const positionals: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const raw = arg.slice(2)
    const eq = raw.indexOf('=')
    if (eq >= 0) {
      flags[raw.slice(0, eq)] = parsePluginCliValue(raw.slice(eq + 1))
      continue
    }
    const next = args[i + 1]
    if (next && !next.startsWith('--')) {
      flags[raw] = parsePluginCliValue(next)
      i++
    } else {
      flags[raw] = true
    }
  }
  return { flags, positionals }
}

function commandWords(command: PluginCliCommand): string[] {
  const words = command.usage.trim().split(/\s+/)
  return words[0] === 'bakin' ? words.slice(1) : words
}

function isPlaceholder(word: string): boolean {
  return /^<[^>]+>$/.test(word)
}

function placeholderName(word: string): string {
  return word.slice(1, -1).replace(/\?$/, '')
}

function matchPluginCliCommand(command: PluginCliCommand, cmd: string, rawArgs: string[]): Record<string, unknown> | null {
  const usage = commandWords(command)
  const parsed = parsePluginCliArgs(rawArgs)
  const provided = [cmd, ...parsed.positionals]
  let providedIndex = 0

  for (let usageIndex = 0; usageIndex < usage.length; usageIndex++) {
    const word = usage[usageIndex]
    if (word.startsWith('[')) continue
    if (isPlaceholder(word)) break

    const actual = provided[providedIndex]
    if (actual === undefined) {
      if (word === 'list' && providedIndex === 1 && command.name.endsWith(':list')) continue
      return null
    }
    if (actual !== word) return null
    providedIndex++
  }

  const params: Record<string, unknown> = { ...parsed.flags }
  const placeholders = usage.filter(isPlaceholder)
  for (const placeholder of placeholders) {
    const value = provided[providedIndex]
    if (value === undefined) return null
    params[placeholderName(placeholder)] = parsePluginCliValue(value)
    providedIndex++
  }

  return params
}

async function dispatchPluginCliCommand(cmd: string, args: string[]): Promise<boolean> {
  const manifest = await apiGet('/api/plugins/manifest') as { plugins: PluginManifestRow[] }
  const commands = manifest.plugins.flatMap(plugin => plugin.contributes?.cliCommands ?? [])
  for (const command of commands) {
    if (!command.dispatch) continue
    const params = matchPluginCliCommand(command, cmd, args)
    if (!params) continue

    if (command.dispatch.type === 'execTool') {
      const result = await apiPost(`/api/exec-tools/${encodeURIComponent(command.dispatch.name)}`, {
        params,
        agent: 'cli',
      })
      print(result)
      return true
    }

    const result = await api(`/api/plugins/${cmd}${command.dispatch.path}`, {
      method: command.dispatch.method,
      body: command.dispatch.method === 'GET' ? undefined : JSON.stringify(params),
    })
    print(result)
    return true
  }
  return false
}

const BINARY_ONLY_COMMANDS = new Set(['start'])
const USAGE = renderCliUsage({ bakinUrl: BASE_URL }, { excludeNames: BINARY_ONLY_COMMANDS })

// ---------------------------------------------------------------------------
// Onboarding CLI handlers
// ---------------------------------------------------------------------------

function statusIcon(status: string): string {
  switch (status) {
    case 'ok': return '[OK]'
    case 'warn': return '[WARN]'
    case 'error': return '[FAIL]'
    case 'missing': return '[MISS]'
    case 'broken': return '[FAIL]'
    case 'skipped': return '[SKIP]'
    default: return `[${status.toUpperCase()}]`
  }
}

async function cmdOnboardingMkdir(): Promise<void> {
  const { mkdirComponent } = await import('../src/core/onboarding/mkdir')
  const opts = {
    interactive: Boolean(process.stdout.isTTY),
    autoApprove: true,
    json: false,
    checkOnly: false,
    force: false,
  }
  const result = await mkdirComponent.install(opts)
  console.log(`${statusIcon(result.status)} ${result.message}`)
  if (result.status === 'failed') process.exit(1)
}

async function cmdOnboardingSettingsInit(): Promise<void> {
  const { settingsComponent } = await import('../src/core/onboarding/settings')
  const opts = {
    interactive: Boolean(process.stdout.isTTY),
    autoApprove: true,
    json: false,
    checkOnly: false,
    force: false,
  }
  const result = await settingsComponent.install(opts)
  console.log(`${statusIcon(result.status)} ${result.message}`)
  if (result.status === 'failed') process.exit(1)
}

async function cmdOnboardingCheckSingle(target: 'runtime' | 'search' | 'search-models' | 'llm' | 'channels' | 'plugin-assets' | 'agent-assets' | 'recommended-plugins' | 'recommended-agents'): Promise<void> {
  const componentMap: Record<string, () => Promise<{ check(): Promise<import('../src/core/onboarding/types').CheckResult> }>> = {
    runtime: async () => (await import('../src/core/onboarding/runtime')).runtimeComponent,
    search: async () => (await import('../src/core/onboarding/search')).searchComponent,
    'search-models': async () => (await import('../src/core/onboarding/search-models')).searchModelsComponent,
    llm: async () => (await import('../src/core/onboarding/credentials')).llmComponent,
    channels: async () => (await import('../src/core/onboarding/credentials')).channelsComponent,
    'plugin-assets': async () => (await import('../src/core/onboarding/plugin-assets')).pluginAssetsComponent,
    'agent-assets': async () => (await import('../src/core/onboarding/agent-assets')).agentAssetsComponent,
    'recommended-plugins': async () => (await import('../src/core/onboarding/recommended-plugins')).recommendedPluginsComponent,
    'recommended-agents': async () => (await import('../src/core/onboarding/recommended-agents')).recommendedAgentsComponent,
  }
  const component = await componentMap[target]()
  const result = await component.check()
  console.log(`${statusIcon(result.status)} ${result.message}`)
  if (result.remediation) console.log(`  → ${result.remediation}`)
  if (result.status === 'missing' || result.status === 'error' || result.status === 'broken') process.exit(1)
  if (result.status === 'warn') process.exit(2)
}

async function cmdOnboardingCheckAll(): Promise<void> {
  const { checkAll } = await import('../src/core/onboarding/index')
  const results = await checkAll()
  for (const r of results) {
    console.log(`${statusIcon(r.status)} ${r.name.padEnd(10)} ${r.message}`)
    if (r.remediation) console.log(`  → ${r.remediation}`)
  }
  const hasError = results.some(r => r.status === 'error' || r.status === 'missing' || r.status === 'broken')
  const hasWarn = results.some(r => r.status === 'warn')
  process.exit(hasError ? 1 : hasWarn ? 2 : 0)
}

async function cmdOnboardingInstallSingle(target: string, args: string[]): Promise<void> {
  const componentMap: Record<string, () => Promise<import('../src/core/onboarding/types').OnboardingComponent>> = {
    search: async () => (await import('../src/core/onboarding/search')).searchComponent,
    'search-models': async () => (await import('../src/core/onboarding/search-models')).searchModelsComponent,
    mcporter: async () => (await import('../src/core/onboarding/mcporter')).mcporterComponent,
    'plugin-assets': async () => (await import('../src/core/onboarding/plugin-assets')).pluginAssetsComponent,
    'agent-assets': async () => (await import('../src/core/onboarding/agent-assets')).agentAssetsComponent,
    'recommended-plugins': async () => (await import('../src/core/onboarding/recommended-plugins')).recommendedPluginsComponent,
    'recommended-agents': async () => (await import('../src/core/onboarding/recommended-agents')).recommendedAgentsComponent,
  }
  const component = await componentMap[target]()
  const isTTY = Boolean(process.stdout.isTTY)
  const autoApprove = args.includes('--yes')
  const json = args.includes('--json')
  const opts = {
    interactive: isTTY && !json,
    autoApprove: autoApprove || (!isTTY && !json),
    json,
    checkOnly: false,
    force: false,
  }
  const result = await component.install(opts)
  if (json) {
    console.log(JSON.stringify({ component: component.name, status: result.status, message: result.message, durationMs: result.durationMs }))
  } else {
    console.log(`${statusIcon(result.status)} ${result.message}`)
  }
  if (result.status === 'failed') process.exit(1)
}

async function cmdOnboard(args: string[]): Promise<void> {
  const { runOnboard, isOnboarded, loadState, COMPONENT_ORDER } = await import('../src/core/onboarding/index')
  const { collectOnboardingSelections } = await import('../src/core/cli/onboarding-interactive')
  const { OnboardingBusy, OnboardingSummary } = await import('../src/core/cli/ui/onboarding')
  const { render, renderToString } = await import('ink')
  const { createElement } = await import('react')
  const checkOnly = args.includes('--check')
  const yes = args.includes('--yes')
  const json = args.includes('--json')
  const force = args.includes('--force')
  const verbose = args.includes('--verbose')
  const isTTY = Boolean(process.stdout.isTTY)

  const previousConsoleFormat = process.env.BAKIN_CONSOLE_FORMAT
  if (!verbose && previousConsoleFormat === undefined) {
    process.env.BAKIN_CONSOLE_FORMAT = 'silent'
  }

  // Early exit for already-onboarded machines unless --force or --check
  if (!force && !checkOnly && isOnboarded()) {
    const state = loadState()
    if (!json) {
      console.log(`[OK] Already onboarded on ${state?.completedAt?.slice(0, 10) ?? 'unknown date'}.`)
      console.log('     Re-run with --force to replay the full flow.')
    } else {
      console.log(JSON.stringify({ status: 'already_onboarded', completedAt: state?.completedAt }))
    }
    process.exit(0)
  }

  const baseOpts = {
    interactive: isTTY && !json && !checkOnly,
    autoApprove: yes || (!isTTY && !json),
    json,
    checkOnly,
    force,
  }
  try {
    const selections = await collectOnboardingSelections(baseOpts)
    const opts = { ...baseOpts, ...selections, interactive: false }

    let busyFrame = 0
    let busyDetail: string | undefined
    const completedOutcomes: Array<{
      name: string
      status: 'complete' | 'warning' | 'skipped' | 'blocked'
      message: string
    }> = []
    let busyTimer: ReturnType<typeof setInterval> | undefined
    const statusForOutcome = (status: 'ok' | 'warn' | 'skipped' | 'error') => {
      if (status === 'ok') return 'complete'
      if (status === 'warn') return 'warning'
      if (status === 'skipped') return 'skipped'
      return 'blocked'
    }
    const renderBusy = () => createElement(OnboardingBusy, {
      label: 'Running onboarding checks and installs',
      detail: busyDetail,
      frame: busyFrame,
      completed: completedOutcomes,
      totalSteps: COMPONENT_ORDER.length,
    })
    const busy = isTTY && !json
      ? render(renderBusy())
      : null
    if (busy) {
      busyTimer = setInterval(() => {
        busyFrame += 1
        busy.rerender(renderBusy())
      }, 80)
    }

    let result: Awaited<ReturnType<typeof runOnboard>>
    try {
      result = await runOnboard({
        ...opts,
        onProgress: busy
          ? (detail: string) => {
            busyDetail = detail
            busyFrame += 1
            busy.rerender(renderBusy())
          }
          : undefined,
        onOutcome: busy
          ? (outcome) => {
            completedOutcomes.push({
              name: outcome.name,
              status: statusForOutcome(outcome.finalStatus),
              message: outcome.message,
            })
            busyFrame += 1
            busy.rerender(renderBusy())
          }
          : undefined,
      })
    } finally {
      if (busyTimer) clearInterval(busyTimer)
      busy?.unmount()
    }

    if (!json) {
      if (isTTY) {
        console.log('')
        console.log(renderToString(createElement(OnboardingSummary, {
          outcomes: result.outcomes,
          exitCode: result.exitCode,
          showBrand: !busy,
        })))
      } else {
        console.log('')
        for (const o of result.outcomes) {
          console.log(`${statusIcon(o.finalStatus)} ${o.name.padEnd(10)} ${o.message}`)
          if (o.remediation && (o.finalStatus === 'error' || o.finalStatus === 'warn')) {
            console.log(`  → ${o.remediation}`)
          }
        }
        console.log('')
        if (result.exitCode === 0) {
          console.log('Onboarding complete. Run `bakin start` to launch Bakin.')
        } else if (result.exitCode === 2) {
          console.log('Onboarding finished with warnings. Bakin will start but some features may be limited.')
          console.log('Run `bakin start` to launch Bakin.')
        } else {
          console.log('Onboarding failed. Fix the errors above and rerun `bakin onboard`.')
        }
      }
    }

    process.exit(result.exitCode)
  } finally {
    if (!verbose && previousConsoleFormat === undefined) {
      delete process.env.BAKIN_CONSOLE_FORMAT
    }
  }
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(USAGE.trim())
    process.exit(0)
  }

  const cmd = args[0]
  const sub = args[1]

  try {
    switch (cmd) {
      case 'status':
        await cmdStatus()
        break

      case 'dispatch':
        await cmdDispatch()
        break

      case 'tasks':
        if (sub === 'list') {
          const colFlag = args.find(a => a.startsWith('--column='))
          await cmdTasksList(colFlag?.split('=')[1])
        } else if (sub === 'get') {
          if (!args[2]) { console.error('Usage: bakin tasks get <id>'); process.exit(1) }
          await cmdTasksGet(args[2])
        } else if (sub === 'create') {
          if (!args[2]) { console.error('Usage: bakin tasks create <title> [agent] [--workflow=<id>] [--no-workflow="<reason>"]'); process.exit(1) }
          // Parse flags from remaining args
          const createArgs = args.slice(2)
          const wfFlag = createArgs.find(a => a.startsWith('--workflow='))
          const noWfFlag = createArgs.find(a => a.startsWith('--no-workflow='))
          const positional = createArgs.filter(a => !a.startsWith('--'))
          const createTitle = positional[0]
          const createAssignee = positional[1]
          const createWorkflowId = wfFlag?.split('=').slice(1).join('=')
          const createSkipReason = noWfFlag?.split('=').slice(1).join('=')
          if (!createTitle) { console.error('Usage: bakin tasks create <title> [agent] [--workflow=<id>] [--no-workflow="<reason>"]'); process.exit(1) }
          await cmdTasksCreate(createTitle, createAssignee, createWorkflowId, createSkipReason)
        } else if (sub === 'move') {
          if (!args[2] || !args[3]) { console.error('Usage: bakin tasks move <id> <column>'); process.exit(1) }
          await cmdTasksMove(args[2], args[3])
        } else if (sub === 'log') {
          if (!args[2] || !args[3]) { console.error('Usage: bakin tasks log <id> <message>'); process.exit(1) }
          await cmdTasksLog(args[2], args.slice(3).join(' '))
        } else if (sub === 'block') {
          if (!args[2] || !args[3]) { console.error('Usage: bakin tasks block <id> <reason>'); process.exit(1) }
          await cmdTasksBlock(args[2], args.slice(3).join(' '))
        } else if (sub === 'depend') {
          if (!args[2] || !args[3]) { console.error('Usage: bakin tasks depend <id> <dependsOn>'); process.exit(1) }
          await cmdTasksDepend(args[2], args[3])
        } else if (sub === 'complete') {
          if (!args[2] || !args[3]) { console.error('Usage: bakin tasks complete <id> <summary>'); process.exit(1) }
          await cmdTasksComplete(args[2], args.slice(3).join(' '))
        } else {
          console.error(`Unknown tasks subcommand: ${sub}`)
          process.exit(1)
        }
        break

      case 'workflows':
        if (sub === 'list') {
          await cmdWorkflowsList()
        } else if (sub === 'start') {
          if (!args[2] || !args[3]) { console.error('Usage: bakin workflows start <taskId> <workflowId>'); process.exit(1) }
          await cmdWorkflowsStart(args[2], args[3])
        } else if (sub === 'step') {
          if (!args[2]) { console.error('Usage: bakin workflows step <taskId>'); process.exit(1) }
          await cmdWorkflowsStep(args[2])
        } else if (sub === 'submit') {
          if (!args[2] || !args[3] || !args[4]) { console.error('Usage: bakin workflows submit <taskId> <stepId> \'<json>\''); process.exit(1) }
          await cmdWorkflowsSubmit(args[2], args[3], args[4])
        } else {
          console.error(`Unknown workflows subcommand: ${sub}`)
          process.exit(1)
        }
        break

      case 'agents':
        if (sub === 'list') {
          // `bakin agents list --packages` → package state view
          // `bakin agents list`            → existing runtime view
          if (args.includes('--packages')) {
            await cmdAgentPackagesList(parseAgentsFlags(args.slice(2)))
          } else {
            await cmdAgentsList()
          }
        } else if (sub === 'status') {
          if (!args[2]) { console.error('Usage: bakin agents status <id>'); process.exit(1) }
          await cmdAgentsStatus(args[2])
        } else if (sub === 'tasks') {
          if (!args[2]) { console.error('Usage: bakin agents tasks <id>'); process.exit(1) }
          await cmdAgentsTasks(args[2])
        } else if (sub === 'send') {
          if (!args[2] || !args[3]) { console.error('Usage: bakin agents send <id> <message>'); process.exit(1) }
          await cmdAgentsSend(args[2], args.slice(3).join(' '))
        } else if (sub === 'install') {
          if (!args[2]) { console.error('Usage: bakin agents install <path|github:user/repo[@ref][#subpath]> [--adopt] [--install-as <id>] [--replace]'); process.exit(1) }
          await cmdAgentPackagesInstall(args[2], parseAgentsFlags(args.slice(3)))
        } else if (sub === 'remove') {
          if (!args[2]) { console.error('Usage: bakin agents remove <agent-id> [--keep-blocks] [--delete-agent] [--force]'); process.exit(1) }
          await cmdAgentPackagesRemove(args[2], parseAgentsFlags(args.slice(3)))
        } else if (sub === 'update') {
          // `bakin agents update` (no id) updates everything; `bakin agents update <id>` is targeted
          const id = args[2] && !args[2].startsWith('--') ? args[2] : undefined
          const flagsStart = id ? 3 : 2
          await cmdAgentPackagesUpdate(id, parseAgentsFlags(args.slice(flagsStart)))
        } else if (sub === 'lessons') {
          const lessonSub = args[2]
          if (lessonSub === 'list') {
            if (!args[3]) { console.error('Usage: bakin agents lessons list <agent-id>'); process.exit(1) }
            await cmdAgentPackagesLessonsList(args[3])
          } else if (lessonSub === 'enable' || lessonSub === 'disable') {
            if (!args[3] || !args[4]) { console.error(`Usage: bakin agents lessons ${lessonSub} <agent-id> <lesson-id>`); process.exit(1) }
            await cmdAgentPackagesLessonsToggle(args[3], args[4], lessonSub === 'enable')
          } else {
            console.error(`Unknown agents lessons subcommand: ${lessonSub ?? '(none)'}`)
            console.error('Available: list | enable | disable')
            process.exit(1)
          }
        } else {
          console.error(`Unknown agents subcommand: ${sub}`)
          console.error('Available: list | status | tasks | send | install | remove | update | lessons {list,enable,disable}')
          process.exit(1)
        }
        break

      case 'settings':
        if (sub === 'get') {
          await cmdSettingsGet(args[2])
        } else if (sub === 'set') {
          if (!args[2] || !args[3]) { console.error('Usage: bakin settings set <key> <value>'); process.exit(1) }
          await cmdSettingsSet(args[2], args[3])
        } else if (sub === 'init') {
          await cmdOnboardingSettingsInit()
        } else {
          console.error(`Unknown settings subcommand: ${sub}`)
          process.exit(1)
        }
        break

      case 'plugins':
        if (sub === 'list') {
          await cmdPluginsList()
        } else if (sub === 'install') {
          const installArgs = args.slice(2)
          const parsed = parsePluginInstallArgs(installArgs)
          if (parsed.error || !parsed.source) {
            console.error(parsed.error ? `${parsed.error}\n${PLUGIN_INSTALL_USAGE}` : PLUGIN_INSTALL_USAGE)
            process.exit(1)
          }
          await cmdPluginsInstall(parsed.source, {
            yes: parsed.yes,
            dev: parsed.dev,
            force: parsed.force,
            ref: parsed.ref,
          })
        } else if (sub === 'export') {
          if (args[2]?.startsWith('--')) { console.error('Usage: bakin plugins export [file]'); process.exit(1) }
          await cmdPluginsExport(args[2])
        } else if (sub === 'import') {
          if (!args[2]) { console.error('Usage: bakin plugins import <file> [--yes] [--force]'); process.exit(1) }
          const flags = args.slice(3)
          const extraArg = flags.find(arg => !arg.startsWith('--'))
          if (extraArg) {
            console.error(`Unexpected plugins import argument: ${extraArg}`)
            console.error('Usage: bakin plugins import <file> [--yes] [--force]')
            process.exit(1)
          }
          const unknown = flags.find(arg => arg.startsWith('--') && arg !== '--yes' && arg !== '--force')
          if (unknown) {
            console.error(`Unknown plugins import flag: ${unknown}`)
            console.error('Usage: bakin plugins import <file> [--yes] [--force]')
            process.exit(1)
          }
          await cmdPluginsImport(args[2], { yes: flags.includes('--yes'), force: flags.includes('--force') })
        } else if (sub === 'remove') {
          if (!args[2]) { console.error('Usage: bakin plugins remove <id>'); process.exit(1) }
          await cmdPluginsRemove(args[2])
        } else if (sub === 'restore') {
          if (!args[2]) { console.error(PLUGIN_RESTORE_USAGE); process.exit(1) }
          const parsed = parsePluginRestoreFlags(args.slice(3))
          if (parsed.error) {
            console.error(parsed.error)
            console.error(PLUGIN_RESTORE_USAGE)
            process.exit(1)
          }
          await cmdPluginsRestore(args[2], {
            snapshot: parsed.snapshot,
            force: parsed.force,
            list: parsed.list,
          })
        } else if (sub === 'link') {
          if (!args[2]) { console.error('Usage: bakin plugins link <localPath> [--force]'); process.exit(1) }
          await cmdPluginsLink(args[2], { force: args.slice(3).includes('--force') })
        } else if (sub === 'unlink') {
          if (!args[2]) { console.error('Usage: bakin plugins unlink <id>'); process.exit(1) }
          await cmdPluginsUnlink(args[2])
        } else {
          console.error(`Unknown plugins subcommand: ${sub}`)
          process.exit(1)
        }
        break

      case 'packages':
        if (sub === 'install') {
          if (!args[2]) { console.error('Usage: bakin packages install <path|github:user/repo[@ref][#subpath]> [--install-as <id>] [--replace]'); process.exit(1) }
          await cmdPackagesInstall(args[2], parseAgentsFlags(args.slice(3)))
        } else if (sub === 'list') {
          await cmdPackagesList(parseAgentsFlags(args.slice(2)))
        } else if (sub === 'remove') {
          if (!args[2]) { console.error('Usage: bakin packages remove <package-id> [--force] [--keep-blocks]'); process.exit(1) }
          await cmdPackagesRemove(args[2], parseAgentsFlags(args.slice(3)))
        } else if (sub === 'update') {
          if (!args[2]) { console.error('Usage: bakin packages update <package-id> [--refresh-template]'); process.exit(1) }
          await cmdPackagesUpdate(args[2], parseAgentsFlags(args.slice(3)))
        } else {
          console.error(`Unknown packages subcommand: ${sub ?? '(none)'}`)
          console.error('Available: install | list | remove | update')
          process.exit(1)
        }
        break

      case 'stop':
        await cmdStop()
        break

      case 'logs':
        await cmdLogs(args[1])
        break

      case 'setup':
        if (sub === 'service') {
          const uninstall = args.includes('--uninstall')
          await cmdSetupService({ uninstall })
        } else {
          console.error(`Unknown setup target: ${sub}`)
          console.error('Available: bakin setup service')
          process.exit(1)
        }
        break

      case 'paths':
        await cmdPaths(args[1])
        break

      case 'agent-rules': {
        const apply = args.includes('--apply')
        const check = args.includes('--check')
        const applyAll = args.includes('--apply-all')
        const checkAll = args.includes('--check-all')
        await cmdAgentRules({ apply, check, applyAll, checkAll })
        break
      }

      case 'mkdir':
        await cmdOnboardingMkdir()
        break

      case 'check':
        if (sub === 'runtime' || sub === 'search' || sub === 'search-models' || sub === 'llm' || sub === 'channels' || sub === 'plugin-assets' || sub === 'agent-assets' || sub === 'recommended-plugins' || sub === 'recommended-agents') {
          await cmdOnboardingCheckSingle(sub)
        } else if (sub === 'all') {
          await cmdOnboardingCheckAll()
        } else {
          console.error(`Unknown check target: ${sub}`)
          console.error('Available: bakin check runtime | search | search-models | llm | channels | plugin-assets | agent-assets | recommended-plugins | recommended-agents | all')
          process.exit(1)
        }
        break

      case 'install':
        if (sub === 'search' || sub === 'search-models' || sub === 'mcporter' || sub === 'plugin-assets' || sub === 'agent-assets' || sub === 'recommended-plugins' || sub === 'recommended-agents') {
          await cmdOnboardingInstallSingle(sub, args)
        } else {
          console.error(`Unknown install target: ${sub}`)
          console.error('Available: bakin install search | search-models | mcporter | plugin-assets | agent-assets | recommended-plugins | recommended-agents')
          process.exit(1)
        }
        break

      case 'onboard':
        await cmdOnboard(args)
        break

      case 'doctor':
        await cmdDoctor(args.slice(1))
        break

      case 'dev': {
        // Delegate to the unified cmdDev in src/core/cli.ts so the source-
        // tree detection + spawn logic lives in one place (and the
        // compiled binary's `bakin dev` uses the same code path).
        const { cmdDev } = await import('../src/core/cli')
        process.exit(await cmdDev(args.slice(1)))
        break  // unreachable, but eslint's no-fallthrough doesn't know that
      }

      case 'reboot':
      case 'restart':
        await cmdReboot()
        break

      case 'reindex': {
        const reindexOpts: { table?: string; rebuild?: boolean } = {}
        for (let i = 1; i < args.length; i++) {
          if (args[i].startsWith('--table=')) reindexOpts.table = args[i].split('=')[1]
          else if (args[i] === '--table' && args[i + 1]) reindexOpts.table = args[++i]
          else if (args[i] === '--rebuild') reindexOpts.rebuild = true
        }
        await cmdReindex(reindexOpts)
        break
      }

      case 'docs':
        await cmdDocs()
        break

      case 'search': {
        const searchOpts: { table?: string; limit?: number; agent?: string; facets?: string } = {}
        const queryParts: string[] = []
        for (let i = 1; i < args.length; i++) {
          if (args[i].startsWith('--table=')) searchOpts.table = args[i].split('=')[1]
          else if (args[i] === '--table' && args[i + 1]) searchOpts.table = args[++i]
          else if (args[i].startsWith('--agent=')) searchOpts.agent = args[i].split('=')[1]
          else if (args[i] === '--agent' && args[i + 1]) searchOpts.agent = args[++i]
          else if (args[i].startsWith('--limit=')) searchOpts.limit = Number(args[i].split('=')[1])
          else if (args[i] === '--limit' && args[i + 1]) searchOpts.limit = Number(args[++i])
          else if (args[i].startsWith('--facets=')) searchOpts.facets = args[i].split('=')[1]
          else if (args[i] === '--facets' && args[i + 1]) searchOpts.facets = args[++i]
          else queryParts.push(args[i])
        }
        if (!queryParts.length) { console.error('Usage: bakin search <query> [--table=tasks] [--limit=10] [--facets=status,agent]'); process.exit(1) }
        await cmdSearch(queryParts.join(' '), searchOpts)
        break
      }

      case 'search:stats':
        await cmdSearchStats()
        break

      case 'trash':
        if (!sub || sub === 'list') {
          await cmdTrashList()
        } else if (sub === 'restore') {
          if (!args[2]) { console.error('Usage: bakin trash restore <filename>'); process.exit(1) }
          await cmdTrashRestore(args[2])
        } else if (sub === 'empty') {
          await cmdTrashEmpty()
        } else {
          console.error(`Unknown trash subcommand: ${sub}`)
          process.exit(1)
        }
        break

      case 'schedule':
        if (!sub || sub === 'list') {
          await cmdScheduleList({ agent: args.includes('--agent') ? args[args.indexOf('--agent') + 1] : undefined })
        } else if (sub === 'add') {
          if (!args[2] || !args[3]) { console.error('Usage: bakin schedule add <name> <schedule> [--agent <id>] [--prompt <text>]'); process.exit(1) }
          const agentIdx = args.indexOf('--agent')
          const promptIdx = args.indexOf('--prompt')
          await cmdScheduleAdd({
            name: args[2],
            schedule: args[3],
            agent: agentIdx > -1 ? args[agentIdx + 1] : undefined,
            prompt: promptIdx > -1 ? args.slice(promptIdx + 1).join(' ') : undefined,
          })
        } else if (sub === 'pause') {
          if (!args[2]) { console.error('Usage: bakin schedule pause <jobId> [--until <date>] [--skip <n>]'); process.exit(1) }
          const untilIdx = args.indexOf('--until')
          const skipIdx = args.indexOf('--skip')
          await cmdSchedulePause(args[2], {
            until: untilIdx > -1 ? args[untilIdx + 1] : undefined,
            skip: skipIdx > -1 ? Number(args[skipIdx + 1]) : undefined,
          })
        } else if (sub === 'resume') {
          if (!args[2]) { console.error('Usage: bakin schedule resume <jobId>'); process.exit(1) }
          await cmdScheduleResume(args[2])
        } else if (sub === 'remove') {
          if (!args[2]) { console.error('Usage: bakin schedule remove <jobId>'); process.exit(1) }
          await cmdScheduleRemove(args[2])
        } else if (sub === 'run') {
          if (!args[2]) { console.error('Usage: bakin schedule run <jobId>'); process.exit(1) }
          await cmdScheduleRun(args[2])
        } else if (sub === 'runs') {
          if (!args[2]) { console.error('Usage: bakin schedule runs <jobId>'); process.exit(1) }
          await cmdScheduleRuns(args[2], { limit: 20 })
        } else {
          console.error(`Unknown schedule subcommand: ${sub}`)
          process.exit(1)
        }
        break

      default:
        if (!BINARY_ONLY_COMMANDS.has(cmd) && await dispatchPluginCliCommand(cmd, args.slice(1))) {
          break
        }
        console.error(`Unknown command: ${cmd}`)
        console.log(USAGE.trim())
        process.exit(1)
    }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('ECONNREFUSED') ||
        err.message.includes('Unable to connect') ||
        err.message.includes('fetch failed'))
    ) {
      console.error('Error: Cannot connect to Bakin. Is the server running?')
      console.error(`  Tried: ${BASE_URL}`)
      console.error(`  Run \`bakin start\` to launch the server.`)
    } else {
      console.error('Error:', err instanceof Error ? err.message : String(err))
    }
    process.exit(1)
  }
}

// Only auto-invoke when this file is the entry point (npm-linked
// `/opt/homebrew/bin/bakin` shell invocation). When imported from the
// compiled binary's src/core/cli.ts to delegate unknown commands,
// import.meta.main is false and the binary's dispatcher drives us.
if (import.meta.main) {
  main()
}
