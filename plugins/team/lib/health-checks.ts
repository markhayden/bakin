/** Canonical Team health checks and independently registered repair actions. */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import {
  healthError,
  healthHealthy,
  healthObserved,
  healthUnknown,
  healthWarning,
} from '@makinbakin/sdk/utils'

import { resolveProviderKeySource, type DirectProviderId } from '@bakin/core/llm/provider-keys'
import { readTaskboard } from '../../../src/core/task-store'
import { scanAgentSync, type SyncScanReport } from '../../../src/core/agent-packages/sync-scanner'
import { syncAllAgents } from '../../../src/core/agent-packages/sync'
import { migrateToManagedBlocks } from '../../../src/core/agent-packages/migration'
import { refreshRoleContextBlocks } from '../../../src/core/team-context'
import type {
  HealthCheckRunInput,
  HealthObservationInput,
  HealthRepairActionDefinition,
} from '../../../packages/core/src/plugin-types'

type RuntimeAgentReader = Pick<AgentRuntimeAdapter['agents'], 'list'>
const ACTIVE_COLUMNS = ['backlog', 'todo', 'inProgress', 'review', 'blocked'] as const

function stablePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'unknown'
}

function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function agentResources(agentIds: string[]) {
  return agentIds.slice(0, 50).map(id => ({ kind: 'agent' as const, id: stablePart(id), label: bounded(id, 120) }))
}

/** Verify routing credentials only when unresolved team-assigned tasks need them. */
export async function checkTeamRouting(opts: {
  routingProvider?: string
  readBoard?: () => { columns: Record<string, Array<{ team?: string; agent?: string }>> }
  keySource?: (provider: DirectProviderId) => { apiKey: string; source: 'env' | 'store' } | null
}): Promise<HealthCheckRunInput> {
  const readBoard = opts.readBoard ?? readTaskboard
  const keySource = opts.keySource ?? resolveProviderKeySource
  const provider: DirectProviderId =
    opts.routingProvider === 'openai' || opts.routingProvider === 'google' ? opts.routingProvider : 'anthropic'

  let unresolvedCount = 0
  try {
    const { columns } = readBoard()
    for (const column of ACTIVE_COLUMNS) {
      for (const task of columns[column] ?? []) {
        if (task.team && !task.agent) unresolvedCount++
      }
    }
  } catch (error) {
    return healthObserved([healthUnknown({
      key: 'task-board',
      summary: `Team routing demand could not be inspected: ${error instanceof Error ? error.message : String(error)}`,
      incident: {
        key: 'task-board',
        title: 'Team routing readiness could not be verified',
        impact: 'Bakin cannot determine whether unresolved team tasks have a usable routing path.',
        disposition: 'watch',
        resources: [{ kind: 'plugin', id: 'tasks', label: 'Tasks' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun check' },
      },
    })])
  }

  if (unresolvedCount === 0) {
    return healthObserved([healthHealthy({ key: 'routing', summary: 'No unresolved team-assigned tasks require routing.' })])
  }
  if (!keySource(provider)) {
    return healthObserved([healthError({
      key: 'routing-key',
      summary: `${unresolvedCount} unresolved team task(s) have no API key for routing provider ${provider}.`,
      evidence: { unresolvedTasks: unresolvedCount, provider },
      incident: {
        key: 'routing-key',
        title: 'Team task routing is blocked',
        impact: 'Unresolved team-assigned tasks will block when dispatch tries to choose an agent.',
        disposition: 'action_required',
        resources: [{ kind: 'setting', id: 'team.routing-provider', label: 'Team routing provider' }],
        resolution: { key: 'configure-routing', type: 'navigate', label: 'Configure routing', href: '/settings' },
      },
    })])
  }
  return healthObserved([healthHealthy({
    key: 'routing',
    summary: `${unresolvedCount} unresolved team task(s) can route through ${provider}.`,
    evidence: { unresolvedTasks: unresolvedCount, provider },
  })])
}

/** Verify that the runtime exposes a readable, coherent agent roster. */
export async function checkAgentRoster(runtime: RuntimeAgentReader): Promise<HealthCheckRunInput> {
  let agents: Awaited<ReturnType<RuntimeAgentReader['list']>>
  try {
    agents = await runtime.list()
  } catch (error) {
    return healthObserved([healthUnknown({
      key: 'roster-read',
      summary: `The runtime agent roster could not be read: ${error instanceof Error ? error.message : String(error)}`,
      incident: {
        key: 'roster-read',
        title: 'Agent roster verification is unavailable',
        impact: 'Bakin cannot verify which agents are available for dispatch.',
        disposition: 'watch',
        resources: [{ kind: 'runtime', id: 'agents', label: 'Runtime agents' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun check' },
      },
    })])
  }

  const observations: HealthObservationInput[] = []
  const seen = new Set<string>()
  agents.forEach((agent, index) => {
    if (!agent.id) {
      observations.push(healthWarning({
        key: `missing-id-${index}`,
        summary: `Runtime agent at roster position ${index + 1} has no id.`,
        evidence: { rosterIndex: index },
        incident: {
          key: `missing-id-${index}`,
          title: 'A runtime agent has no stable id',
          impact: 'The agent cannot be addressed reliably by tasks, sessions, or health views.',
          disposition: 'action_required',
          resources: [{ kind: 'runtime', id: `agent-index-${index}`, label: `Roster entry ${index + 1}` }],
          resolution: { key: 'review-team', type: 'navigate', label: 'Review Team', href: '/team' },
        },
      }))
      return
    }
    if (seen.has(agent.id)) {
      observations.push(healthWarning({
        key: `duplicate-${stablePart(agent.id)}`,
        summary: `Runtime agent id ${agent.id} appears more than once.`,
        incident: {
          key: `duplicate-${stablePart(agent.id)}`,
          title: `Agent id ${agent.id} is duplicated`,
          impact: 'Dispatch and activity attribution cannot distinguish the duplicate agents reliably.',
          disposition: 'action_required',
          resources: [{ kind: 'agent', id: stablePart(agent.id), label: bounded(agent.name || agent.id, 120) }],
          resolution: { key: 'review-team', type: 'navigate', label: 'Review Team', href: '/team' },
        },
      }))
    }
    seen.add(agent.id)
  })

  if (observations.length === 0) {
    observations.push(healthHealthy({
      key: 'roster',
      summary: `${agents.length} runtime agent(s) have unique stable ids.`,
      evidence: { count: agents.length },
    }))
  }
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}

/** Verify that each runtime agent has a persona file. */
export async function checkPersonas(
  contentDir: string,
  runtime: RuntimeAgentReader,
): Promise<HealthCheckRunInput> {
  let agentIds: string[]
  try {
    agentIds = (await runtime.list()).map(agent => agent.id).filter(Boolean)
  } catch (error) {
    return healthObserved([healthUnknown({
      key: 'roster-read',
      summary: `Runtime agents could not be read while checking personas: ${error instanceof Error ? error.message : String(error)}`,
      incident: {
        key: 'roster-read',
        title: 'Persona coverage could not be verified',
        impact: 'Bakin cannot determine which agent persona files should exist.',
        disposition: 'watch',
        resources: [{ kind: 'runtime', id: 'agents', label: 'Runtime agents' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun check' },
      },
    })])
  }

  const personasDir = join(contentDir, 'team', 'personas')
  if (!existsSync(personasDir)) {
    return healthObserved([healthWarning({
      key: 'directory-missing',
      summary: 'The team/personas directory is missing.',
      evidence: { agents: agentIds },
      incident: {
        key: 'directory-missing',
        title: 'Agent personas are missing',
        impact: 'Agents may lack their intended personality and communication guidance.',
        disposition: 'action_required',
        resources: [{ kind: 'directory', id: 'team.personas', label: 'Agent personas' }, ...agentResources(agentIds).slice(0, 49)],
        resolution: { key: 'create-personas', type: 'repair', label: 'Create persona stubs', actionId: 'create-personas' },
      },
    })])
  }

  const existing = new Set(readdirSync(personasDir).filter(file => file.endsWith('.md')).map(file => file.replace('.md', '')))
  const missing = agentIds.filter(agent => !existing.has(agent))
  if (missing.length === 0) {
    return healthObserved([healthHealthy({
      key: 'personas',
      summary: `All ${agentIds.length} runtime agent(s) have persona files.`,
      evidence: { count: agentIds.length },
    })])
  }
  return healthObserved(missing.map(agent => healthWarning({
    key: `missing-${stablePart(agent)}`,
    summary: `Agent ${agent} has no persona file.`,
    evidence: { agent },
    incident: {
      key: `missing-${stablePart(agent)}`,
      title: `Persona missing for ${agent}`,
      impact: 'The agent may lack its intended personality and communication guidance.',
      disposition: 'action_required' as const,
      resources: [{ kind: 'agent' as const, id: stablePart(agent), label: bounded(agent, 120) }, { kind: 'file' as const, id: `team.personas.${stablePart(agent)}.md`, label: bounded(`${agent}.md`, 120) }],
      resolution: { key: 'create-personas', type: 'repair' as const, label: 'Create persona stub', actionId: 'create-personas' },
    },
  })) as [HealthObservationInput, ...HealthObservationInput[]])
}

function personaStub(agent: string): string {
  return `# ${agent.charAt(0).toUpperCase() + agent.slice(1)}\n\n_Persona not yet configured. Update this file with the agent's personality, background, and communication style._\n`
}

/** Create only missing persona stubs for the current runtime roster. */
export function personaRepair(contentDir: string, runtime: RuntimeAgentReader): HealthRepairActionDefinition {
  return {
    id: 'create-personas',
    name: 'Create missing persona files',
    async plan() {
      let agentIds: string[]
      try { agentIds = (await runtime.list()).map(agent => agent.id).filter(Boolean) } catch { return [] }
      const personasDir = join(contentDir, 'team', 'personas')
      const existing = new Set(existsSync(personasDir)
        ? readdirSync(personasDir).filter(file => file.endsWith('.md')).map(file => file.replace('.md', ''))
        : [])
      const missing = agentIds.filter(agent => !existing.has(agent))
      if (missing.length === 0) return []
      return [{
        id: 'create-personas',
        actionId: 'create-personas',
        title: 'Create missing persona files',
        reason: `${missing.length} runtime agent(s) lack persona files.`,
        safety: 'safe',
        incidentIds: [],
        observationIds: [],
        preconditions: [],
        changes: missing.map(agent => ({
          kind: 'file' as const,
          target: join(personasDir, `${agent}.md`),
          action: 'create' as const,
          description: `Create a clearly marked persona stub for ${agent}.`,
        })),
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      try {
        const agentIds = (await runtime.list()).map(agent => agent.id).filter(Boolean)
        const personasDir = join(contentDir, 'team', 'personas')
        mkdirSync(personasDir, { recursive: true })
        const existing = new Set(readdirSync(personasDir).filter(file => file.endsWith('.md')).map(file => file.replace('.md', '')))
        const changes: Array<{ kind: 'file'; target: string; action: 'create'; description: string }> = []
        for (const agent of agentIds) {
          if (existing.has(agent)) continue
          const path = join(personasDir, `${agent}.md`)
          writeFileSync(path, personaStub(agent), 'utf-8')
          changes.push({ kind: 'file' as const, target: path, action: 'create' as const, description: `Created a persona stub for ${agent}.` })
        }
        return items.map(item => ({
          itemId: item.id,
          actionId: item.actionId,
          status: changes.length > 0 ? 'applied' as const : 'skipped' as const,
          message: changes.length > 0 ? `Created ${changes.length} persona stub(s).` : 'All runtime agents already have persona files.',
          affectedCheckIds: ['team.personas'],
          changes,
        }))
      } catch (error) {
        return items.map(item => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'failed' as const,
          message: error instanceof Error ? error.message : String(error),
          affectedCheckIds: ['team.personas'],
          changes: [],
        }))
      }
    },
  }
}

function agentsOf(findings: SyncScanReport['findings']): string[] {
  return [...new Set(findings.map(finding => finding.agentId).filter((agent): agent is string => Boolean(agent)))]
}

/** Verify managed blocks, projections, role context, edit locks, and migration state. */
export async function checkAgentSync(): Promise<HealthCheckRunInput> {
  let report: SyncScanReport
  try {
    report = await scanAgentSync()
  } catch (error) {
    return healthObserved([healthUnknown({
      key: 'scan',
      summary: `Agent sync state could not be scanned: ${error instanceof Error ? error.message : String(error)}`,
      incident: {
        key: 'scan',
        title: 'Agent sync verification is unavailable',
        impact: 'Managed blocks and projected files could not be compared with their expected state.',
        disposition: 'watch',
        resources: [{ kind: 'runtime', id: 'agents', label: 'Runtime agents' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun check' },
      },
    })])
  }

  if (report.findings.length === 0) {
    return healthObserved([healthHealthy({
      key: 'sync',
      summary: `${report.agentsScanned} agent(s) are in sync; ${report.blocksOk} block(s) and ${report.projectionsOk} projection(s) verified.`,
      evidence: { agents: report.agentsScanned, blocks: report.blocksOk, projections: report.projectionsOk },
    })])
  }

  const observations: HealthObservationInput[] = []
  const errors = report.findings.filter(finding => finding.severity === 'error')
  const migration = report.findings.filter(finding => finding.type === 'migration-needed')
  const fixable = report.findings.filter(finding => finding.severity === 'warn' && finding.autoFixable && finding.type !== 'migration-needed')
  const locked = report.findings.filter(finding => finding.type === 'user-edited')
  const advisory = report.findings.filter(finding =>
    finding.severity === 'warn' && !finding.autoFixable && finding.type !== 'user-edited' && finding.type !== 'migration-needed')

  if (errors.length > 0) {
    const agents = agentsOf(errors)
    observations.push(healthError({
      key: 'structural',
      summary: `${errors.length} structural agent-sync issue(s) require review.`,
      detail: errors.slice(0, 5).map(finding => finding.message).join('\n'),
      evidence: { agents, count: errors.length },
      incident: {
        key: 'structural',
        title: 'Agent package structure is incomplete',
        impact: 'Affected agents may start with missing or invalid managed context.',
        disposition: 'action_required',
        resources: agentResources(agents),
        resolution: { key: 'review-agents', type: 'navigate', label: 'Review agents', href: '/team' },
      },
    }))
  }
  if (fixable.length > 0) {
    const agents = agentsOf(fixable)
    const runtimeSwitch = fixable.some(finding => finding.staleInputs?.includes('tool-access'))
    observations.push(healthWarning({
      key: 'local-drift',
      summary: `${fixable.length} managed agent item(s) are stale${runtimeSwitch ? ' after a runtime tool-access change' : ''}.`,
      detail: fixable.slice(0, 5).map(finding => finding.message).join('\n'),
      evidence: { agents, count: fixable.length, runtimeToolAccessChanged: runtimeSwitch },
      incident: {
        key: 'local-drift',
        title: 'Managed agent content is stale',
        impact: 'Affected agents may use context or projected files that no longer match the installed sources.',
        disposition: 'action_required',
        resources: agentResources(agents),
        resolution: { key: 'sync-agents', type: 'repair', label: 'Sync agents locally', actionId: 'sync-agents' },
      },
    }))
  }
  if (migration.length > 0) {
    const agents = agentsOf(migration)
    observations.push(healthWarning({
      key: 'migration',
      summary: `${migration.length} agent package(s) need the one-time managed-block migration.`,
      evidence: { agents, count: migration.length },
      incident: {
        key: 'migration',
        title: 'Agent packages need managed-block migration',
        impact: 'Legacy package workspace files cannot participate in safe block-level synchronization until migrated.',
        disposition: 'action_required',
        resources: agentResources(agents),
        resolution: { key: 'migrate-agent-blocks', type: 'repair', label: 'Review migration', actionId: 'migrate-agent-blocks' },
      },
    }))
  }
  if (locked.length > 0) {
    const agents = agentsOf(locked)
    observations.push(healthWarning({
      key: 'user-edited',
      summary: `${locked.length} user-edited agent file(s) are intentionally locked from sync.`,
      detail: locked.map(finding => finding.target ?? finding.file ?? finding.message).join('\n'),
      evidence: { agents, count: locked.length },
      incident: {
        key: 'user-edited',
        title: 'User-edited agent files are outside managed sync',
        impact: 'Bakin will preserve these edits, but managed source updates will not reach the locked files.',
        disposition: 'advisory',
        resources: agentResources(agents),
        resolution: { key: 'review-agents', type: 'navigate', label: 'Review agents', href: '/team' },
      },
    }))
  }
  if (advisory.length > 0) {
    const agents = agentsOf(advisory)
    observations.push(healthWarning({
      key: 'advisory',
      summary: `${advisory.length} agent-sync finding(s) need manual review.`,
      detail: advisory.slice(0, 5).map(finding => finding.message).join('\n'),
      evidence: { agents, count: advisory.length },
      incident: {
        key: 'advisory',
        title: 'Agent synchronization needs manual review',
        impact: 'Affected agent files may not match their expected package state.',
        disposition: 'advisory',
        resources: agentResources(agents),
        resolution: { key: 'review-agents', type: 'navigate', label: 'Review agents', href: '/team' },
      },
    }))
  }
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}

/** Recompose managed blocks and re-project files from already installed local sources. */
export function agentSyncRepair(): HealthRepairActionDefinition {
  return {
    id: 'sync-agents',
    name: 'Sync agents locally',
    async plan() {
      const report = await scanAgentSync()
      const fixable = report.findings.filter(finding => finding.severity === 'warn' && finding.autoFixable && finding.type !== 'migration-needed')
      if (fixable.length === 0) return []
      const agents = agentsOf(fixable)
      return [{
        id: 'sync-agents',
        actionId: 'sync-agents',
        title: 'Sync agents locally',
        reason: `${fixable.length} managed block or projection item(s) are stale.`,
        safety: 'safe',
        incidentIds: [],
        observationIds: [],
        preconditions: [],
        changes: [{
          kind: 'runtime',
          target: agents.length > 0 ? agents.join(', ') : 'all agents',
          action: 'update',
          description: 'Recompose managed blocks and re-project skills and assets from installed local sources.',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      try {
        refreshRoleContextBlocks()
        const syncResults = await syncAllAgents({ fetch: false, trigger: 'system' })
        const failed = syncResults.filter(result => result.error)
        const changes = syncResults.filter(result => result.receipt).map(result => ({
          kind: 'runtime' as const,
          target: result.agentId,
          action: 'update' as const,
          description: `${result.receipt!.blocks.filter(block => block.action === 'recomposed').length} block(s) recomposed and ${result.receipt!.projections.length} projection(s) written.`,
        }))
        return items.map(item => ({
          itemId: item.id,
          actionId: item.actionId,
          status: failed.length === syncResults.length && syncResults.length > 0 ? 'failed' as const : 'applied' as const,
          message: `Synced ${syncResults.length - failed.length} agent(s) locally${failed.length > 0 ? `; ${failed.length} failed` : ''}.`,
          affectedCheckIds: ['team.agent-sync'],
          changes,
        }))
      } catch (error) {
        return items.map(item => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'failed' as const,
          message: error instanceof Error ? error.message : String(error),
          affectedCheckIds: ['team.agent-sync'],
          changes: [],
        }))
      }
    },
  }
}

/** Back up and migrate legacy package workspace files to managed blocks. */
export function agentSyncMigrationRepair(): HealthRepairActionDefinition {
  return {
    id: 'migrate-agent-blocks',
    name: 'Migrate agent packages to managed blocks',
    async plan() {
      const report = await scanAgentSync()
      if (!report.migrationNeeded) return []
      const packages = report.findings.filter(finding => finding.type === 'migration-needed').map(finding => finding.packageId).filter((id): id is string => Boolean(id))
      return [{
        id: 'migrate-agent-blocks',
        actionId: 'migrate-agent-blocks',
        title: 'Migrate agent packages to managed blocks',
        reason: `Legacy packages require migration: ${packages.join(', ') || 'unknown package'}. A backup is created first.`,
        safety: 'destructive',
        incidentIds: [],
        observationIds: [],
        preconditions: [],
        changes: [{
          kind: 'runtime',
          target: packages.join(', ') || 'legacy agent packages',
          action: 'update',
          description: 'Back up and replace legacy package workspace files with managed-block composition, then rewrite the lockfile.',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      try {
        const result = await migrateToManagedBlocks({ trigger: 'system' })
        const failed = result.agents.filter(agent => agent.error)
        const changes = result.agents.filter(agent => !agent.error).map(agent => ({
          kind: 'runtime' as const,
          target: agent.agentId,
          action: 'update' as const,
          description: agent.state === 'managed'
            ? `Overwrote ${agent.filesOverwritten.join(', ')}.`
            : `Swapped legacy blocks (${agent.legacyBlocksRemoved.join(', ')}).`,
        }))
        return items.map(item => ({
          itemId: item.id,
          actionId: item.actionId,
          status: failed.length > 0 && failed.length === result.agents.length ? 'failed' as const : result.alreadyMigrated ? 'skipped' as const : 'applied' as const,
          message: result.alreadyMigrated
            ? 'Agent packages are already migrated.'
            : `Migrated ${result.agents.length - failed.length} agent(s)${failed.length > 0 ? `; ${failed.length} failed` : ''}. Backup: ${result.backupPath ?? 'n/a'}.`,
          affectedCheckIds: ['team.agent-sync'],
          changes,
        }))
      } catch (error) {
        return items.map(item => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'failed' as const,
          message: error instanceof Error ? error.message : String(error),
          affectedCheckIds: ['team.agent-sync'],
          changes: [],
        }))
      }
    },
  }
}
