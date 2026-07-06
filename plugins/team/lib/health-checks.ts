/**
 * Team-plugin-owned doctor checks.
 *
 * Migrated out of src/core/doctor.ts (#139) — these three checks operate
 * on team-plugin data (agent roster sync, persona files, agent-package
 * projection drift) so they belong with the plugin that owns those
 * concerns.
 *
 * Registered in plugins/team/index.ts activate() via
 * ctx.registerHealthCheck. runDiagnostics() picks them up through the
 * plugin-check loop in src/core/doctor.ts's runPluginHealthChecks().
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { healthOk as ok, healthWarn as warn, healthError as error } from '@makinbakin/sdk/utils'

import { resolveProviderKeySource, type DirectProviderId } from '@bakin/core/llm/provider-keys'
import { readTaskboard } from '../../../src/core/task-store'
import { scanAgentSync, type SyncScanReport } from '../../../src/core/agent-packages/sync-scanner'
import { syncAllAgents } from '../../../src/core/agent-packages/sync'
import { migrateToManagedBlocks } from '../../../src/core/agent-packages/migration'
import { refreshRoleContextBlocks } from '../../../src/core/team-context'
import type {
  HealthCheckResult,
  HealthRepairApplyResult,
  HealthRepairHandler,
  HealthRepairPlanItem,
} from '../../../packages/core/src/plugin-types'

type RuntimeAgentReader = Pick<AgentRuntimeAdapter['agents'], 'list'>

// ─── Result constructors (inlined; matches workflows precedent) ─────────────


// ─── Team routing readiness (#189) ──────────────────────────────────────────

const ACTIVE_COLUMNS = ['backlog', 'todo', 'inProgress', 'review', 'blocked'] as const

/**
 * Warn-only: team-assigned tasks exist but the routing LLM key is missing —
 * every one of them will hit the dispatch resolver's structural failure and
 * block. Local-only (settings + board + key presence; no network).
 */
export async function checkTeamRouting(opts: {
  routingProvider?: string
  readBoard?: () => { columns: Record<string, Array<{ team?: string }>> }
  keySource?: (provider: DirectProviderId) => { apiKey: string; source: 'env' | 'store' } | null
}): Promise<HealthCheckResult[]> {
  const readBoard = opts.readBoard ?? readTaskboard
  const keySource = opts.keySource ?? resolveProviderKeySource
  const provider: DirectProviderId =
    opts.routingProvider === 'openai' || opts.routingProvider === 'google' ? opts.routingProvider : 'anthropic'

  let teamTaskCount = 0
  try {
    const { columns } = readBoard()
    for (const col of ACTIVE_COLUMNS) {
      for (const task of columns[col] ?? []) {
        if (task.team) teamTaskCount++
      }
    }
  } catch (err) {
    return [warn('routing', `Could not inspect the task board for team assignments: ${err}`, true)]
  }

  if (teamTaskCount === 0) {
    return [ok('routing', 'No active team-assigned tasks — routing idle')]
  }
  if (!keySource(provider)) {
    return [warn('routing', `${teamTaskCount} team-assigned task(s) but no API key for routing provider "${provider}" — they will block at dispatch. Set the provider key (env or secret store) or change the Task routing provider in Team settings.`)]
  }
  return [ok('routing', `${teamTaskCount} team-assigned task(s); routing ready via ${provider}`)]
}

// ─── Agent roster: runtime agents exposed to Bakin ─────────────────────────

/**
 * Verify the runtime adapter can provide a coherent agent roster.
 * NOT auto-fixable - which runtime condition is "right" requires human
 * judgment.
 */
export async function checkAgentRoster(runtime: RuntimeAgentReader): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = []
  let agents: Awaited<ReturnType<RuntimeAgentReader['list']>>
  try {
    agents = await runtime.list()
  } catch (err) {
    return [error('agent-roster', `Failed to read runtime agent roster: ${err}`)]
  }

  const seen = new Set<string>()
  for (const agent of agents) {
    if (!agent.id) {
      results.push(warn('agent-roster', 'Runtime returned an agent without an id'))
      continue
    }
    if (seen.has(agent.id)) {
      results.push(warn('agent-roster', `Duplicate runtime agent id "${agent.id}"`))
    }
    seen.add(agent.id)
  }

  if (results.length === 0) {
    results.push(ok('agent-roster', `${agents.length} runtime agent(s) available`))
  }

  return results
}

// ─── Personas: each agent has a persona file under {contentDir}/team/personas

/**
 * Verify each agent has a persona file. Report-only; personaRepair creates
 * missing stub files explicitly through the doctor repair workflow.
 */
export async function checkPersonas(
  contentDir: string,
  runtime: RuntimeAgentReader,
): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = []
  let agentIds: string[]
  try {
    agentIds = (await runtime.list()).map(agent => agent.id).filter(Boolean)
  } catch (err) {
    return [warn('personas', `Failed to read runtime agents: ${err}`, true)]
  }
  const personasDir = join(contentDir, 'team', 'personas')

  if (!existsSync(personasDir)) {
    results.push(warn('personas', `No personas directory at ${personasDir}`, true))
    return results
  }

  const existing = new Set(
    readdirSync(personasDir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''))
  )

  for (const agent of agentIds) {
    if (!existing.has(agent)) {
      results.push(warn('personas', `Missing persona: ${join(personasDir, `${agent}.md`)}`, true))
    }
  }

  if (results.filter(r => r.check === 'personas').length === 0) {
    results.push(ok('personas', `All ${agentIds.length} agents have persona files`))
  }

  return results
}

function personaStub(agent: string): string {
  return `# ${agent.charAt(0).toUpperCase() + agent.slice(1)}\n\n_Persona not yet configured. Update this file with the agent's personality, background, and communication style._\n`
}

export function personaRepair(contentDir: string, runtime: RuntimeAgentReader): HealthRepairHandler {
  return {
    async plan(rows) {
      const matching = rows.filter(row => row.check === 'personas' && row.autoFixable)
      if (matching.length === 0) return []
      return [{
        id: 'team.create-personas',
        checkId: 'personas',
        title: 'Create missing persona files',
        reason: matching.map(row => row.message).join('; '),
        safety: 'safe',
        requiresConfirmation: true,
        changes: [{
          kind: 'file',
          target: join(contentDir, 'team', 'personas'),
          action: 'create',
          description: 'Create the personas directory and stub markdown files for runtime agents missing personas.',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      const agentIds = (await runtime.list()).map(agent => agent.id).filter(Boolean)
      const personasDir = join(contentDir, 'team', 'personas')
      mkdirSync(personasDir, { recursive: true })
      const existing = new Set(
        existsSync(personasDir)
          ? readdirSync(personasDir).filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''))
          : [],
      )
      const changes = []
      for (const agent of agentIds) {
        if (existing.has(agent)) continue
        const path = join(personasDir, `${agent}.md`)
        writeFileSync(path, personaStub(agent), 'utf-8')
        changes.push({
          kind: 'file' as const,
          target: path,
          action: 'create' as const,
          description: `Created stub persona for ${agent}.`,
        })
      }
      return [{
        id: 'team.create-personas',
        checkId: 'personas',
        status: 'applied',
        message: `Created ${changes.length} stub persona file(s).`,
        changes,
      }]
    },
  }
}

// ─── Agent sync: managed blocks + projections vs expected state ────────────

/**
 * The unified local sync check (layered-context spec): managed-block
 * staleness with per-layer attribution, skill/asset drift, role-context
 * freshness, `.userEdited` locks, and migration state. Wraps the same
 * scanner as `bakin check agent-sync` so the two views never disagree.
 * Local-only — never touches the network.
 */
export async function checkAgentSync(): Promise<HealthCheckResult[]> {
  let report: SyncScanReport
  try {
    report = await scanAgentSync()
  } catch (err) {
    return [error('agent-sync', `agent-sync scan failed: ${err}`)]
  }

  if (report.findings.length === 0) {
    return [ok(
      'agent-sync',
      `${report.agentsScanned} agent(s) in sync — ${report.blocksOk} block(s), ${report.projectionsOk} projection(s) verified`,
    )]
  }

  const results: HealthCheckResult[] = []
  const errors = report.findings.filter((f) => f.severity === 'error')
  const fixable = report.findings.filter((f) => f.severity === 'warn' && f.autoFixable)
  const locked = report.findings.filter((f) => f.type === 'user-edited')
  const migration = report.findings.filter((f) => f.type === 'migration-needed')

  if (errors.length > 0) {
    results.push(error(
      'agent-sync',
      `${errors.length} structural issue(s): ${errors.slice(0, 3).map((f) => f.message).join('; ')}${errors.length > 3 ? '; …' : ''}`,
    ))
  }
  if (fixable.length > 0) {
    results.push(warn(
      'agent-sync',
      `${fixable.length} stale item(s): ${fixable.slice(0, 3).map((f) => f.message).join('; ')}${fixable.length > 3 ? '; …' : ''}`,
      true,
    ))
  }
  if (migration.length > 0) {
    results.push(warn(
      'agent-sync',
      `${migration.length} package(s) need the one-time block migration — run \`bakin agents sync\` and confirm`,
    ))
  }
  if (locked.length > 0) {
    results.push(warn(
      'agent-sync',
      `${locked.length} user-edited file(s) locked from sync: ${locked.map((f) => f.target).join(', ')}`,
    ))
  }
  return results
}

export function agentSyncRepair(): HealthRepairHandler {
  return {
    async plan(rows) {
      if (!rows.some(row => row.check === 'agent-sync' && row.status !== 'ok')) return []
      // Re-scan for rich findings — the summary rows don't carry them.
      const report = await scanAgentSync()
      const items: HealthRepairPlanItem[] = []

      const fixable = report.findings.filter((f) => f.autoFixable)
      if (fixable.length > 0) {
        const agents = [...new Set(fixable.map((f) => f.agentId).filter(Boolean))] as string[]
        items.push({
          id: 'team.agent-sync.local',
          checkId: 'agent-sync',
          title: 'Sync agents locally (recompose blocks, re-project files)',
          reason: fixable.slice(0, 5).map((f) => f.message).join('; ') + (fixable.length > 5 ? '; …' : ''),
          safety: 'safe',
          requiresConfirmation: false,
          changes: [{
            kind: 'runtime',
            target: agents.length > 0 ? agents.join(', ') : 'all agents',
            action: 'update',
            description: 'Recompose managed blocks and re-project skills/assets from installed sources (no network).',
          }],
        })
      }

      if (report.migrationNeeded) {
        const packages = report.findings
          .filter((f) => f.type === 'migration-needed')
          .map((f) => f.packageId)
          .filter(Boolean)
        items.push({
          id: 'team.agent-sync.migrate',
          checkId: 'agent-sync',
          title: 'Run the one-time block migration (FULL OVERWRITE of package workspace files)',
          reason: `Packages predate block-based projection: ${packages.join(', ')}. Workspace files will be replaced with freshly composed content; a tarball backup is taken first.`,
          safety: 'destructive',
          requiresConfirmation: true,
          changes: [{
            kind: 'runtime',
            target: packages.join(', '),
            action: 'update',
            description: "Overwrite managed agents' workspace files with composed blocks; swap legacy blocks on unmanaged agents; rewrite the lockfile.",
          }],
        })
      }

      return items
    },
    async apply(items) {
      const results: HealthRepairApplyResult[] = []
      for (const item of items) {
        if (item.id === 'team.agent-sync.migrate') {
          const result = await migrateToManagedBlocks({ trigger: 'system' })
          const failed = result.agents.filter((a) => a.error)
          results.push({
            id: item.id,
            checkId: 'agent-sync',
            status: failed.length > 0 && failed.length === result.agents.length ? 'failed' : 'applied',
            message: result.alreadyMigrated
              ? 'Already migrated — nothing to do.'
              : `Migrated ${result.agents.length - failed.length} agent(s)${failed.length > 0 ? `; failed: ${failed.map((f) => f.agentId).join(', ')}` : ''}. Backup: ${result.backupPath ?? 'n/a'}`,
            changes: result.agents.filter((a) => !a.error).map((a) => ({
              kind: 'runtime' as const,
              target: a.agentId,
              action: 'update' as const,
              description: a.state === 'managed'
                ? `Overwrote ${a.filesOverwritten.join(', ')}`
                : `Swapped legacy blocks (${a.legacyBlocksRemoved.join(', ')})`,
            })),
          })
          continue
        }

        refreshRoleContextBlocks()
        const syncResults = await syncAllAgents({ fetch: false, trigger: 'system' })
        const failed = syncResults.filter((r) => r.error)
        results.push({
          id: item.id,
          checkId: 'agent-sync',
          status: failed.length === syncResults.length && syncResults.length > 0 ? 'failed' : 'applied',
          message: `Synced ${syncResults.length - failed.length} agent(s) locally${failed.length > 0 ? `; failed: ${failed.map((f) => `${f.agentId} (${f.error})`).join('; ')}` : ''}.`,
          changes: syncResults.filter((r) => r.receipt).map((r) => ({
            kind: 'runtime' as const,
            target: r.agentId,
            action: 'update' as const,
            description: `${r.receipt!.blocks.filter((b) => b.action === 'recomposed').length} block(s) recomposed, ${r.receipt!.projections.length} projection(s) written.`,
          })),
        })
      }
      return results
    },
  }
}
