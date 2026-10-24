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

import { readTaskboard } from '../../../src/core/task-store'
import { scanAgentSync, type SyncScanReport } from '../../../src/core/agent-packages/sync-scanner'
import { syncAllAgents } from '../../../src/core/agent-packages/sync'
import { migrateToManagedBlocks } from '../../../src/core/agent-packages/migration'
import { refreshRoleContextBlocks } from '../../../src/core/team-context'
import type {
  HealthCheckRunInput,
  HealthIncidentDeclaration,
  HealthObservationInput,
  HealthRepairActionDefinition,
} from '../../../packages/core/src/plugin-types'

// ─── Incident catalogs (three-outcomes contract, re-homing rows 102–116) ───
// Every family the four checks may emit; the registry refuses a dangling
// action, so the actions register BEFORE the checks in index.ts.

/** team.routing — rows 102–104: inspection failures are observations; no credentials is a human need. */
export const TEAM_ROUTING_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'runtime-credentials', subjectKind: 'runtime', resolution: { type: 'human', needs: 'credential' }, required: 'always' },
]

/** team.agent-roster — rows 105–107: an unreadable roster is an observation; broken entries are the operator's call on the roster editor. */
export const TEAM_AGENT_ROSTER_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'missing-id', subjectKind: 'agent', resolution: { type: 'human', needs: 'decision' }, required: 'always' },
  { id: 'duplicate', subjectKind: 'agent', resolution: { type: 'human', needs: 'decision' }, required: 'always' },
]

/** team.personas — rows 108–110. */
export const TEAM_PERSONAS_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'directory-missing', subjectKind: 'system', resolution: { type: 'repair', actionId: 'create-personas' }, required: 'always' },
  { id: 'missing', subjectKind: 'agent', resolution: { type: 'repair', actionId: 'create-personas' }, required: 'always' },
]

/** team.agent-sync — rows 111–116; `structural` is split by finding (row 112). */
export const TEAM_AGENT_SYNC_INCIDENTS: HealthIncidentDeclaration[] = [
  /** skill-missing / asset-missing / owned file-missing — auto-fixable structural findings. */
  { id: 'structural', subjectKind: 'agent', resolution: { type: 'repair', actionId: 'sync-agents' }, required: 'always' },
  /** bin-manifest-invalid — a symptom of the pack; folds under package:<pack> (resolvedBy the health plugin's reinstall). */
  { id: 'structural-package', subjectKind: 'package', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' },
  /** block-broken / source-missing — nothing deterministic; the fallback lane investigates. */
  { id: 'structural-opaque', subjectKind: 'agent', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' },
  { id: 'local-drift', subjectKind: 'agent', resolution: { type: 'repair', actionId: 'sync-agents' }, required: 'always' },
  { id: 'migration', subjectKind: 'agent', resolution: { type: 'repair', actionId: 'migrate-agent-blocks' }, required: 'always' },
]

type RuntimeAgentReader = Pick<AgentRuntimeAdapter['agents'], 'list' | 'registryLocation'>
const ACTIVE_COLUMNS = ['backlog', 'todo', 'inProgress', 'review', 'blocked'] as const

function stablePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'unknown'
}

/** The handoff command for the registry file: the operator's editor, never a Bakin write. */
export function registryEditCommand(path: string): string {
  return `"\${EDITOR:-nano}" ${JSON.stringify(path)}`
}

/** `agents.registryLocation()` when the runtime has it; a throwing or absent member is "no location", never an error. */
async function registryLocationOf(runtime: RuntimeAgentReader): Promise<{ path: string; entryKey: (index: number) => string } | null> {
  if (typeof runtime.registryLocation !== 'function') return null
  try {
    return await runtime.registryLocation()
  } catch {
    return null
  }
}

function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function agentResources(agentIds: string[]) {
  return agentIds.slice(0, 50).map(id => ({ kind: 'agent' as const, id: stablePart(id), label: bounded(id, 120) }))
}

/** Verify routing readiness only when unresolved team-assigned tasks need
 * it. The routing call rides the active runtime (an ephemeral main-agent
 * turn) — readiness means the runtime has usable LLM credentials, not that
 * Bakin holds an API key. */
export async function checkTeamRouting(opts: {
  readBoard?: () => { columns: Record<string, Array<{ team?: string; agent?: string }>> }
  /** The active runtime's credential surface (adapter-neutral). */
  credentialStatus: () => Promise<{ llmProviders: string[] }>
  /** Resolved 'team-routing' matrix route model; absent = inherit. */
  routeModel?: string
}): Promise<HealthCheckRunInput> {
  const readBoard = opts.readBoard ?? readTaskboard
  const model = opts.routeModel ?? 'inherit'

  let unresolvedCount = 0
  try {
    const { columns } = readBoard()
    for (const column of ACTIVE_COLUMNS) {
      for (const task of columns[column] ?? []) {
        if (task.team && !task.agent) unresolvedCount++
      }
    }
  } catch (error) {
    // Row 102: an inspection failure is an observation — the check's maxAgeMs re-runs it.
    return healthObserved([healthUnknown({
      key: 'task-board',
      summary: 'Team routing demand could not be inspected.',
      detail: (error instanceof Error ? error.message : String(error)) || undefined,
    })])
  }

  if (unresolvedCount === 0) {
    return healthObserved([healthHealthy({ key: 'routing', summary: 'No unresolved team-assigned tasks require routing.' })])
  }

  let providers: string[]
  try {
    providers = (await opts.credentialStatus()).llmProviders
  } catch (error) {
    // Row 103: could not see — an observation, never a card.
    return healthObserved([healthUnknown({
      key: 'runtime-credentials',
      summary: 'Runtime credential status could not be read.',
      detail: (error instanceof Error ? error.message : String(error)) || undefined,
      evidence: { unresolvedTasks: unresolvedCount },
    })])
  }

  if (providers.length === 0) {
    return healthObserved([healthError({
      key: 'runtime-credentials',
      summary: `${unresolvedCount} unresolved team task(s) cannot route — the runtime has no usable LLM credentials.`,
      evidence: { unresolvedTasks: unresolvedCount, model },
      incident: {
        key: 'runtime-credentials',
        title: 'Team task routing is blocked',
        impact: 'Unresolved team-assigned tasks will fail resolution when dispatch tries to choose an agent.',
        disposition: 'action_required',
        subject: { kind: 'runtime', id: 'active', label: 'Active runtime' },
        declarationId: 'runtime-credentials',
        resources: [{ kind: 'runtime', id: 'credentials', label: 'Runtime credentials' }],
        // Row 104: a credential only the operator can supply — the /runtime credential tiles are the control.
        resolution: { key: 'review-runtime-credentials', type: 'human', needs: 'credential', label: 'Review runtime credentials', href: '/runtime?tab=overview&field=credentials', field: 'runtime-field-credentials' },
      },
    })])
  }

  return healthObserved([healthHealthy({
    key: 'routing',
    summary: `${unresolvedCount} unresolved team task(s) can route through the runtime (model: ${model}).`,
    evidence: { unresolvedTasks: unresolvedCount, model, llmProviders: providers.length },
  })])
}

/** Verify that the runtime exposes a readable, coherent agent roster. */
export async function checkAgentRoster(runtime: RuntimeAgentReader): Promise<HealthCheckRunInput> {
  let agents: Awaited<ReturnType<RuntimeAgentReader['list']>>
  try {
    agents = await runtime.list()
  } catch (error) {
    // Row 105: observation only.
    return healthObserved([healthUnknown({
      key: 'roster-read',
      summary: 'The runtime agent roster could not be read.',
      detail: (error instanceof Error ? error.message : String(error)) || undefined,
    })])
  }

  // Rows 106/107: every finding is ENTRY-ADDRESSED — the roster position(s)
  // ride the evidence and the control's href, so `/team?recover=1` can put
  // its editor row on the failing entry instead of a list of sentences.
  const observations: HealthObservationInput[] = []
  const workspaceOf = (agent: { metadata?: Record<string, unknown> }): string | undefined => {
    const candidate = agent.metadata?.workspace ?? agent.metadata?.workspacePath
    return typeof candidate === 'string' && candidate !== '' ? bounded(candidate, 500) : undefined
  }
  const positionsById = new Map<string, number[]>()
  // Row 106: the contract addresses agents BY id, so an id-less entry's only
  // honest control is the registry file itself — `agents.registryLocation()`
  // (optional) names the file and the entry key; without it the row names
  // the position and nothing else.
  const location = agents.some((agent) => !agent.id) ? await registryLocationOf(runtime) : null
  agents.forEach((agent, index) => {
    if (!agent.id) {
      const workspace = workspaceOf(agent)
      const entryKey = location?.entryKey(index)
      const registry = location && entryKey ? { path: location.path, entryKey } : null
      observations.push(healthWarning({
        key: `missing-id-${index}`,
        summary: `Runtime agent at roster position ${index + 1} has no id.`,
        evidence: {
          kind: 'missing-id', rosterIndex: index,
          ...(agent.name ? { name: bounded(agent.name, 120) } : {}),
          ...(workspace ? { workspace } : {}),
          ...(registry ? { registry } : {}),
        },
        incident: {
          key: `missing-id-${index}`,
          title: 'A runtime agent has no stable id',
          impact: registry
            ? `Roster entry ${index + 1} cannot be addressed by tasks, sessions, or health views. Give it an id at ${registry.entryKey} in ${registry.path}, save, then recheck — the runtime addresses agents by id, so nothing in Bakin can name the entry until then.`
            : `Roster entry ${index + 1} cannot be addressed by tasks, sessions, or health views — nothing in Bakin can name it until the runtime's registry gives it an id.`,
          disposition: 'action_required',
          subject: { kind: 'agent', id: `roster-${index}`, label: `Roster entry ${index + 1}` },
          declarationId: 'missing-id',
          resources: [{ kind: 'runtime', id: `roster-entry-${index}`, label: `Roster entry ${index + 1}` }],
          resolution: {
            key: 'recover-roster', type: 'human', needs: 'decision', label: 'Fix roster entry', href: `/team?recover=1&entry=${index}`,
            ...(registry ? { handoff: { command: registryEditCommand(registry.path) } } : {}),
          },
        },
      }))
      return
    }
    positionsById.set(agent.id, [...(positionsById.get(agent.id) ?? []), index])
  })
  for (const [agentId, positions] of positionsById) {
    if (positions.length < 2) continue
    const names = [...new Set(positions.map((index) => agents[index]!.name || agentId))].map((name) => bounded(name, 120))
    const label = bounded(agents[positions[0]!]!.name || agentId, 120)
    observations.push(healthWarning({
      key: `duplicate-${stablePart(agentId)}`,
      summary: `Runtime agent id ${agentId} appears ${positions.length} times (roster positions ${positions.map((index) => index + 1).join(', ')}).`,
      evidence: { kind: 'duplicate', agentId: bounded(agentId, 120), positions, names },
      incident: {
        key: `duplicate-${stablePart(agentId)}`,
        title: `Agent id ${agentId} is duplicated`,
        impact: `Dispatch and activity attribution cannot tell the ${positions.length} roster entries named ${agentId} apart; removing the agent removes every entry with this id.`,
        disposition: 'action_required',
        subject: { kind: 'agent', id: stablePart(agentId), label },
        declarationId: 'duplicate',
        resources: [
          { kind: 'agent', id: stablePart(agentId), label },
          ...positions.map((index) => ({ kind: 'runtime' as const, id: `roster-entry-${index}`, label: `Roster entry ${index + 1}` })),
        ],
        resolution: { key: 'recover-roster', type: 'human', needs: 'decision', label: 'Resolve the duplicate', href: `/team?recover=1&agent=${encodeURIComponent(agentId)}` },
      },
    }))
  }

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
    // Row 108: observation only.
    return healthObserved([healthUnknown({
      key: 'roster-read',
      summary: 'Runtime agents could not be read while checking personas.',
      detail: (error instanceof Error ? error.message : String(error)) || undefined,
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
        subject: { kind: 'system', id: 'personas', label: 'Agent personas' },
        declarationId: 'directory-missing',
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
      subject: { kind: 'agent' as const, id: stablePart(agent), label: bounded(agent, 120) },
      declarationId: 'missing',
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
    // Creates stub files only — nothing deleted, spent or widened.
    effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: false },
    mutation: 'none',
    operationPlan: () => ({
      stages: [{ id: 'create', kind: 'committing', label: 'Create persona stubs' }],
      pointOfNoReturn: 'create',
    }),
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
    async apply(items, op) {
      if (items.length === 0) return []
      try {
        const agentIds = (await runtime.list()).map(agent => agent.id).filter(Boolean)
        const personasDir = join(contentDir, 'team', 'personas')
        op.stage('create')
        mkdirSync(personasDir, { recursive: true })
        const existing = new Set(readdirSync(personasDir).filter(file => file.endsWith('.md')).map(file => file.replace('.md', '')))
        const changes: Array<{ kind: 'file'; target: string; action: 'create'; description: string }> = []
        for (const agent of agentIds) {
          if (existing.has(agent)) continue
          const path = join(personasDir, `${agent}.md`)
          writeFileSync(path, personaStub(agent), 'utf-8')
          op.item('create', { id: agent, label: agent, status: 'done' })
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

/** ONE agent names itself; several (or none known) roll up under the roster subject. */
function agentSubject(agents: string[]): { kind: 'agent'; id: string; label: string } {
  if (agents.length === 1) return { kind: 'agent', id: stablePart(agents[0]!), label: bounded(agents[0]!, 120) }
  return { kind: 'agent', id: 'roster', label: agents.length === 0 ? 'Runtime agents' : `${agents.length} agents` }
}

/** Verify managed blocks, projections, role context, edit locks, and migration state. */
export async function checkAgentSync(): Promise<HealthCheckRunInput> {
  let report: SyncScanReport
  try {
    report = await scanAgentSync()
  } catch (error) {
    // Row 111: observation only.
    return healthObserved([healthUnknown({
      key: 'scan',
      summary: 'Agent sync state could not be scanned.',
      detail: (error instanceof Error ? error.message : String(error)) || undefined,
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

  // Row 112 — structural, split by finding: auto-fixable misses (skill /
  // asset / owned file) are the sync repair; a bin-manifest problem belongs
  // to the PACK (folds under it, the health plugin's reinstall resolves it);
  // broken blocks and missing sources have no deterministic repair.
  const structuralFixable = errors.filter(finding => finding.autoFixable && finding.type !== 'bin-manifest-invalid')
  const structuralPackage = errors.filter(finding => finding.type === 'bin-manifest-invalid')
  const structuralOpaque = errors.filter(finding => !finding.autoFixable && finding.type !== 'bin-manifest-invalid')
  if (structuralFixable.length > 0) {
    const agents = agentsOf(structuralFixable)
    observations.push(healthError({
      key: 'structural',
      summary: `${structuralFixable.length} structural agent-sync issue(s) can be re-projected.`,
      detail: structuralFixable.slice(0, 5).map(finding => finding.message).join('\n'),
      evidence: { agents, count: structuralFixable.length, types: [...new Set(structuralFixable.map(finding => finding.type))] },
      incident: {
        key: 'structural',
        title: 'Agent package structure is incomplete',
        impact: 'Affected agents may start with missing managed context until their skills, assets and owned files are re-projected.',
        disposition: 'action_required',
        subject: agentSubject(agents),
        declarationId: 'structural',
        resources: agentResources(agents),
        resolution: { key: 'sync-agents', type: 'repair', label: 'Re-project the missing content', actionId: 'sync-agents' },
      },
    }))
  }
  for (const finding of structuralPackage) {
    const packageId = finding.packageId ?? 'unknown'
    const agents = finding.agentId ? [finding.agentId] : []
    observations.push(healthError({
      key: `structural-package-${stablePart(packageId)}`,
      summary: `Package ${packageId} declares a binary manifest that cannot be verified.`,
      detail: finding.message,
      evidence: { packageId, agents },
      incident: {
        key: `structural-package-${stablePart(packageId)}`,
        title: `Package ${packageId} needs a reinstall`,
        impact: 'Agents using this package may lack its managed binaries until the pack is reinstalled.',
        disposition: 'action_required',
        subject: { kind: 'package', id: packageId, label: bounded(packageId, 120) },
        declarationId: 'structural-package',
        resources: agentResources(agents),
        resolution: { key: 'diagnose', type: 'repair', label: 'Investigate the package', actionId: 'core.diagnose' },
        dependsOn: { subject: { kind: 'package', id: packageId, label: bounded(packageId, 120) }, resolvedBy: 'health.package-reinstall' },
      },
    }))
  }
  if (structuralOpaque.length > 0) {
    const agents = agentsOf(structuralOpaque)
    observations.push(healthError({
      key: 'structural-opaque',
      summary: `${structuralOpaque.length} structural agent-sync issue(s) have no deterministic repair.`,
      detail: structuralOpaque.slice(0, 5).map(finding => finding.message).join('\n'),
      evidence: { agents, count: structuralOpaque.length, types: [...new Set(structuralOpaque.map(finding => finding.type))] },
      incident: {
        key: 'structural-opaque',
        title: 'Agent package structure is broken',
        impact: 'Affected agents may start with invalid managed context; a managed block is broken or its source is gone.',
        disposition: 'action_required',
        subject: agentSubject(agents),
        declarationId: 'structural-opaque',
        resources: agentResources(agents),
        resolution: { key: 'diagnose', type: 'repair', label: 'Investigate the broken package content', actionId: 'core.diagnose' },
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
        subject: agentSubject(agents),
        declarationId: 'local-drift',
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
        subject: agentSubject(agents),
        declarationId: 'migration',
        resources: agentResources(agents),
        resolution: { key: 'migrate-agent-blocks', type: 'repair', label: 'Review migration', actionId: 'migrate-agent-blocks' },
      },
    }))
  }
  if (locked.length > 0) {
    const agents = agentsOf(locked)
    // Row 115: observation only — the operator chose the lock; nothing to decide.
    observations.push(healthWarning({
      key: 'user-edited',
      summary: `${locked.length} user-edited agent file(s) are intentionally locked from sync.`,
      detail: `Bakin preserves these edits; managed source updates do not reach them (review on /team):\n${locked.map(finding => finding.target ?? finding.file ?? finding.message).join('\n')}`,
      evidence: { agents, count: locked.length },
    }))
  }
  if (advisory.length > 0) {
    const agents = agentsOf(advisory)
    // Row 116: observation only.
    observations.push(healthWarning({
      key: 'advisory',
      summary: `${advisory.length} agent-sync finding(s) need manual review.`,
      detail: `Affected agent files may not match their expected package state (review on /team):\n${advisory.slice(0, 5).map(finding => finding.message).join('\n')}`,
      evidence: { agents, count: advisory.length },
    }))
  }
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}

/** Recompose managed blocks and re-project files from already installed local sources. */
export function agentSyncRepair(): HealthRepairActionDefinition {
  return {
    id: 'sync-agents',
    name: 'Sync agents locally',
    effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: false },
    mutation: 'sync',
    resources: ['install-state'],
    operationPlan: () => ({
      stages: [
        { id: 'context', kind: 'preparing', label: 'Refresh role context' },
        { id: 'sync', kind: 'installing', label: 'Recompose and re-project each agent' },
      ],
      pointOfNoReturn: 'context',
    }),
    async plan() {
      const report = await scanAgentSync()
      // Row 112: auto-fixable STRUCTURAL misses (severity error) ride the same re-projection as local drift.
      const fixable = report.findings.filter(finding => finding.autoFixable && finding.type !== 'migration-needed' && finding.type !== 'bin-manifest-invalid')
      if (fixable.length === 0) return []
      const agents = agentsOf(fixable)
      return [{
        id: 'sync-agents',
        actionId: 'sync-agents',
        title: 'Sync agents locally',
        reason: `${fixable.length} managed block or projection item(s) are stale or missing.`,
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
    async apply(items, op) {
      if (items.length === 0) return []
      try {
        op.stage('context')
        refreshRoleContextBlocks()
        op.stage('sync')
        const syncResults = await syncAllAgents({ fetch: false, trigger: 'system' }, (agentId, status, message) => {
          op.item('sync', { id: agentId, label: agentId, status, ...(message ? { message } : {}) })
        })
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
    // Row 114: a full overwrite of the workspace files (tarball backup first) — the operator confirms.
    effects: { deletesUserContent: true, spendsMoney: false, widensAuthorization: false },
    mutation: 'delete',
    resources: ['install-state'],
    operationPlan: () => ({
      stages: [{ id: 'migrate', kind: 'committing', label: 'Back up and migrate to managed blocks' }],
      pointOfNoReturn: 'migrate',
    }),
    async plan() {
      const report = await scanAgentSync()
      if (!report.migrationNeeded) return []
      const packages = report.findings.filter(finding => finding.type === 'migration-needed').map(finding => finding.packageId).filter((id): id is string => Boolean(id))
      return [{
        id: 'migrate-agent-blocks',
        actionId: 'migrate-agent-blocks',
        title: 'Migrate agent packages to managed blocks',
        reason: `Legacy packages require migration: ${packages.join(', ') || 'unknown package'}. A backup is created first.`,
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
    async apply(items, op) {
      if (items.length === 0) return []
      try {
        op.stage('migrate')
        const result = await migrateToManagedBlocks({ trigger: 'system' })
        for (const agent of result.agents) {
          op.item('migrate', { id: agent.agentId, label: agent.agentId, status: agent.error ? 'failed' : 'done', ...(agent.error ? { message: agent.error } : {}) })
        }
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
