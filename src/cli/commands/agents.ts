/**
 * `bakin agents {list,status,tasks,send,install,orphan,delete,remove,sync,lessons}`
 * — runtime agent views + agent-package lifecycle. Relocated verbatim from
 * cli/bakin.ts (B5.3 command-module split).
 *
 * AgentsCmdFlags / parseAgentsFlags / printPackageActionTui are exported: the
 * packages command module shares the same flag parser and action report.
 */
import { apiGet, apiPost, apiPostJson, apiDelete } from '../http'
import { print, printTable } from '../output'
import { exitUsage, exitUnknownSubcommand, confirmPrompt } from '../help'
import { renderInkReport } from '../../core/cli/ui/render-report'
import type { PackageActionData } from '../../core/cli/ui/readonly'
import { printRuntimeActionTui } from './runtime'

async function printAgentsListTui(agents: Array<{ id: string; name: string; status: string; model: string }>): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.AgentsListReport, { agents })
}

async function printAgentStatusTui(agentId: string, profile: Record<string, unknown>): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.AgentStatusReport, { agentId, profile })
}

async function printAgentTasksTui(agentId: string, tasks: Array<Record<string, unknown>>): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.AgentTasksReport, { agentId, tasks })
}

async function printAgentPackagesListTui(agents: Array<Record<string, unknown>>): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.AgentPackagesListReport, { agents })
}

async function printAgentLessonsListTui(
  agentId: string,
  packageId: string,
  lessons: Array<Record<string, unknown>>,
): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.AgentLessonsListReport, { agentId, packageId, lessons })
}

export async function printPackageActionTui(actions: PackageActionData | PackageActionData[]): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.PackageActionReport, {
    actions: Array.isArray(actions) ? actions : [actions],
  })
}

async function cmdAgentsList(opts: { json?: boolean } = {}): Promise<void> {
  const result = await apiGet('/api/plugins/team/') as {
    agents: Array<{ id: string; name: string; status: string; model: string }>
  }
  if (opts.json) {
    print(result)
    return
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

async function printAgentContextTui(report: import('../../core/cli/ui/reports/context').ContextReportData): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.ContextReportReport, { report })
}

async function printAgentContextSummaryTui(agents: Array<import('../../core/cli/ui/reports/context').ContextSummaryRowData>): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.ContextSummaryReport, { agents })
}

async function cmdAgentsContext(agentId: string | undefined, opts: { json?: boolean } = {}): Promise<void> {
  if (agentId) {
    const result = await apiGet(`/api/context-report/${agentId}`) as {
      report: import('../../core/cli/ui/reports/context').ContextReportData
    }
    if (opts.json) {
      print(result)
      return
    }
    if (process.stdout.isTTY) {
      await printAgentContextTui(result.report)
      return
    }
    print(result)
    return
  }
  const result = await apiGet('/api/context-report') as {
    agents: Array<import('../../core/cli/ui/reports/context').ContextSummaryRowData>
  }
  if (opts.json) {
    print(result)
    return
  }
  if (process.stdout.isTTY) {
    await printAgentContextSummaryTui(result.agents)
    return
  }
  for (const row of result.agents) {
    console.log(`  ${row.agentId}: static ${row.staticTaskBytes}B, est. max ${row.estimatedMaxTaskBytes}B, workspace ${row.workspaceAvailable ? `${row.workspaceTotalBytes}B` : 'n/a'}`)
  }
}

async function printAgentDoctorTui(data: import('../../core/cli/ui/reports/agent-doctor').AgentDoctorData): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.AgentDoctorReport, { data })
}

/**
 * `bakin agents doctor <id>` (#385) — thin aggregator over the same four
 * endpoints the web Diagnostics tab uses (drift scan, context report,
 * agent-effort, timeline). Each section degrades independently: an
 * unreachable endpoint renders as "unavailable", never a hard exit.
 */
async function cmdAgentsDoctor(agentId: string, opts: { json?: boolean } = {}): Promise<void> {
  const tryGet = async <T,>(path: string): Promise<T | null> => {
    try {
      return await apiGet(path) as T
    } catch {
      return null
    }
  }

  const [scan, context, effort, timeline] = await Promise.all([
    tryGet<{ findings: import('../../core/cli/ui/reports/agent-doctor').AgentDoctorFindingData[]; scannedAt: string }>(
      `/api/agent-packages/${agentId}/scan`,
    ),
    tryGet<{ report: { dispatch: { estimatedMaxTaskBytes: number }; workspace: { available: boolean; totalBytes: number } } }>(
      `/api/context-report/${agentId}`,
    ),
    tryGet<{ agents: Array<import('../../core/cli/ui/reports/agent-doctor').AgentDoctorEffortData & { agent: string }> }>(
      '/api/plugins/health/agent-effort?window=24h',
    ),
    tryGet<{ events: import('../../core/cli/ui/reports/agent-doctor').AgentDoctorTimelineEventData[] }>(
      `/api/plugins/team/${agentId}/timeline?window=24h`,
    ),
  ])

  const data: import('../../core/cli/ui/reports/agent-doctor').AgentDoctorData = {
    agentId,
    scan: scan ? { findings: scan.findings, scannedAt: scan.scannedAt } : null,
    context: context?.report
      ? {
          estimatedMaxTaskBytes: context.report.dispatch.estimatedMaxTaskBytes,
          workspaceAvailable: context.report.workspace.available,
          workspaceTotalBytes: context.report.workspace.totalBytes,
        }
      : null,
    effort: effort?.agents.find((row) => row.agent === agentId) ?? null,
    timeline: timeline?.events ?? null,
  }

  if (opts.json) {
    print(data)
    return
  }
  if (process.stdout.isTTY) {
    await printAgentDoctorTui(data)
    return
  }
  print(data)
}

async function cmdAgentsSend(agentId: string, message: string): Promise<void> {
  const result = await apiPost(`/api/agents/${agentId}/message`, { message })
  if (process.stdout.isTTY) {
    await printRuntimeActionTui({
      action: 'message',
      target: agentId,
      detail: message,
      result,
    })
    return
  }
  print(result)
}

async function cmdAgentsStatus(agentId: string, opts: { json?: boolean } = {}): Promise<void> {
  const result = await apiGet(`/api/plugins/team/${agentId}`) as Record<string, unknown>
  if (!opts.json && process.stdout.isTTY) {
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

// ---------------------------------------------------------------------------
// Agent-package commands — `bakin agents ...`
// ---------------------------------------------------------------------------

export interface AgentsCmdFlags {
  adopt?: boolean
  installAs?: string
  replace?: boolean
  keepBlocks?: boolean
  deleteAgent?: boolean
  check?: boolean
  reclaim?: string[]
  reclaimAll?: boolean
  yes?: boolean
  force?: boolean
  json?: boolean
}

async function cmdAgentPackagesInstall(source: string, flags: AgentsCmdFlags): Promise<void> {
  const body: Record<string, unknown> = { source }
  if (flags.adopt) body.adopt = source // installer reads any truthy adopt as the agentId
  if (flags.installAs) body.installAs = flags.installAs
  if (flags.replace) body.replace = true
  const result = await apiPost('/api/agent-packages/install', body)
  if (!flags.json && process.stdout.isTTY) {
    await printPackageActionTui({
      action: 'installed',
      scope: 'agent package',
      target: flags.installAs ?? source,
      result,
    })
    return
  }
  print(result)
}

async function cmdAgentPackagesList(flags: AgentsCmdFlags): Promise<void> {
  const result = await apiGet('/api/agent-packages') as {
    ok: boolean
    agents: Array<{
      agentId: string
      state: string
      version?: string
      packageId?: string
      entry?: { version?: string }
    }>
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
    const version = a.version ?? a.entry?.version ?? '-'
    const pkg = a.packageId ? `  [${a.packageId}]` : ''
    console.log(`  ${a.agentId.padEnd(20)} ${a.state.padEnd(10)} ${version.padEnd(10)}${pkg}`)
  }
}

async function cmdAgentPackagesRemove(agentId: string, flags: AgentsCmdFlags): Promise<void> {
  const body: Record<string, unknown> = {}
  if (flags.keepBlocks) body.keepBlocks = true
  if (flags.deleteAgent) body.deleteAgent = true
  if (flags.force) body.force = true
  const result = await apiDelete(`/api/agent-packages/${encodeURIComponent(agentId)}`, body)
  if (!flags.json && process.stdout.isTTY) {
    await printPackageActionTui({
      action: 'removed',
      scope: 'agent package',
      target: agentId,
      result,
    })
    return
  }
  print(result)
}

async function cmdAgentPackagesOrphan(agentId: string, flags: AgentsCmdFlags): Promise<void> {
  await cmdAgentPackagesRemove(agentId, { ...flags, deleteAgent: false })
}

async function cmdAgentPackagesDelete(agentId: string, flags: AgentsCmdFlags): Promise<void> {
  await cmdAgentPackagesRemove(agentId, { ...flags, deleteAgent: true })
}

async function cmdAgentPackagesSync(agentId: string | undefined, flags: AgentsCmdFlags): Promise<void> {
  const body: Record<string, unknown> = {}
  if (flags.check) body.check = true
  if (flags.reclaimAll) body.reclaim = 'all'
  else if (flags.reclaim?.length) body.reclaim = flags.reclaim

  const syncOne = async (id: string): Promise<unknown> => {
    // apiPostJson (not apiPost) — the 409 migrationRequired response is a
    // structured payload we branch on, not a transport error to throw.
    const first = await apiPostJson(`/api/agent-packages/${encodeURIComponent(id)}/sync`, body)
    let result = first.data as Record<string, unknown>
    if (result.migrationRequired) {
      const confirmed = flags.yes || await confirmPrompt(
        `Package for "${id}" predates block-based projection. Run the one-time migration?\n` +
        '  This FULLY OVERWRITES package-managed workspace files with freshly composed content\n' +
        '  (a tarball backup is written to ~/.bakin/.backups/ first). Proceed?',
      )
      if (!confirmed) {
        return { ok: false, error: 'Migration declined — agent left un-synced.' }
      }
      const migration = await apiPost('/api/agent-packages/migrate', {}) as Record<string, unknown>
      if (!migration.ok) return migration
      const second = await apiPostJson(`/api/agent-packages/${encodeURIComponent(id)}/sync`, body)
      result = second.data as Record<string, unknown>
    }
    return result
  }

  const action = flags.check ? 'checked' : 'synced'
  const isFailure = (r: unknown): boolean =>
    typeof r === 'object' && r !== null && (r as { ok?: unknown }).ok === false

  if (agentId) {
    const result = await syncOne(agentId)
    if (!flags.json && process.stdout.isTTY) {
      await printPackageActionTui({ action, scope: 'agent', target: agentId, result })
    } else {
      print(result)
    }
    if (isFailure(result)) process.exit(1)
    return
  }

  // No agentId — sync every runtime agent (managed agents get the full
  // sequence; unmanaged agents get their context block maintained).
  const list = await apiGet('/api/agent-packages') as {
    agents: Array<{ agentId: string; state: string }>
  }
  const actions: PackageActionData[] = []
  let anyFailed = false
  for (const a of list.agents) {
    if (a.state === 'absent') continue
    try {
      const result = await syncOne(a.agentId)
      if (isFailure(result)) anyFailed = true
      if (!flags.json && process.stdout.isTTY) {
        actions.push({ action, scope: 'agent', target: a.agentId, result })
        continue
      }
      console.log(`${a.agentId}:`)
      print(result)
    } catch (err) {
      anyFailed = true
      if (!flags.json && process.stdout.isTTY) {
        actions.push({
          action,
          scope: 'agent',
          target: a.agentId,
          result: { ok: false, error: err instanceof Error ? err.message : String(err) },
        })
        continue
      }
      console.error(`${a.agentId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (!flags.json && process.stdout.isTTY) {
    await printPackageActionTui(actions)
  }
  if (anyFailed) process.exit(1)
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

async function cmdAgentPackagesLessonsToggle(
  agentId: string,
  lessonId: string,
  enabled: boolean,
  opts: { json?: boolean } = {},
): Promise<void> {
  const result = await apiPost(
    `/api/agent-packages/${encodeURIComponent(agentId)}/lessons/${encodeURIComponent(lessonId)}`,
    { enabled },
  )
  if (!opts.json && process.stdout.isTTY) {
    await printPackageActionTui({
      action: enabled ? 'enabled' : 'disabled',
      scope: 'lesson',
      target: lessonId,
      context: agentId,
      result,
    })
    return
  }
  print(result)
}

/** Parse a flag-style argv tail (everything after the positional args). */
export function parseAgentsFlags(args: string[]): AgentsCmdFlags {
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
      case '--delete':
        flags.deleteAgent = true
        break
      case '--orphan':
        flags.deleteAgent = false
        break
      case '--check':
        flags.check = true
        break
      case '--reclaim':
        flags.reclaim = [...(flags.reclaim ?? []), args[++i]]
        break
      case '--reclaim-all':
        flags.reclaimAll = true
        break
      case '--yes':
        flags.yes = true
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

export async function run(args: string[]): Promise<void> {
  const sub = args[1]
  if (sub === 'list') {
    // `bakin agents list --packages` → package state view
    // `bakin agents list`            → existing runtime view
    if (args.includes('--packages')) {
      await cmdAgentPackagesList(parseAgentsFlags(args.slice(2)))
    } else {
      await cmdAgentsList({ json: args.includes('--json') })
    }
  } else if (sub === 'status') {
    if (!args[2]) await exitUsage('bakin agents status <id>')
    await cmdAgentsStatus(args[2], { json: args.includes('--json') })
  } else if (sub === 'tasks') {
    if (!args[2]) await exitUsage('bakin agents tasks <id>')
    await cmdAgentsTasks(args[2])
  } else if (sub === 'context') {
    // `bakin agents context` (no id) = per-agent summary; `<id>` = full breakdown
    const id = args[2] && !args[2].startsWith('--') ? args[2] : undefined
    await cmdAgentsContext(id, { json: args.includes('--json') })
  } else if (sub === 'doctor') {
    if (!args[2] || args[2].startsWith('--')) await exitUsage('bakin agents doctor <id> [--json]')
    await cmdAgentsDoctor(args[2], { json: args.includes('--json') })
  } else if (sub === 'send') {
    if (!args[2] || !args[3]) await exitUsage('bakin agents send <id> <message>')
    await cmdAgentsSend(args[2], args.slice(3).join(' '))
  } else if (sub === 'install') {
    if (!args[2]) await exitUsage('bakin agents install <path|github:user/repo[@ref][#subpath]> [--adopt] [--install-as <id>] [--replace]')
    await cmdAgentPackagesInstall(args[2], parseAgentsFlags(args.slice(3)))
  } else if (sub === 'orphan') {
    if (!args[2]) await exitUsage('bakin agents orphan <agent-id> [--keep-blocks] [--force]')
    await cmdAgentPackagesOrphan(args[2], parseAgentsFlags(args.slice(3)))
  } else if (sub === 'delete') {
    if (!args[2]) await exitUsage('bakin agents delete <agent-id> [--keep-blocks] [--force]')
    await cmdAgentPackagesDelete(args[2], parseAgentsFlags(args.slice(3)))
  } else if (sub === 'remove') {
    if (!args[2]) await exitUsage('bakin agents remove <agent-id> [--keep-blocks] [--delete-agent] [--delete] [--force]')
    await cmdAgentPackagesRemove(args[2], parseAgentsFlags(args.slice(3)))
  } else if (sub === 'sync') {
    // `bakin agents sync` (no id) syncs every agent; `bakin agents sync <id>` is targeted
    const id = args[2] && !args[2].startsWith('--') ? args[2] : undefined
    const flagsStart = id ? 3 : 2
    await cmdAgentPackagesSync(id, parseAgentsFlags(args.slice(flagsStart)))
  } else if (sub === 'lessons') {
    const lessonSub = args[2]
    if (lessonSub === 'list') {
      if (!args[3]) await exitUsage('bakin agents lessons list <agent-id>')
      await cmdAgentPackagesLessonsList(args[3])
    } else if (lessonSub === 'enable' || lessonSub === 'disable') {
      if (!args[3] || !args[4]) await exitUsage(`bakin agents lessons ${lessonSub} <agent-id> <lesson-id>`)
      await cmdAgentPackagesLessonsToggle(args[3], args[4], lessonSub === 'enable', { json: args.includes('--json') })
    } else {
      await exitUnknownSubcommand('agents lessons', lessonSub, ['list', 'enable', 'disable'])
    }
  } else {
    await exitUnknownSubcommand('agents', sub, ['list', 'status', 'tasks', 'context', 'doctor', 'send', 'install', 'orphan', 'delete', 'remove', 'sync', 'lessons'])
  }
}
