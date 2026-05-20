import curatedCatalog from '../../../packages/host/src/data/curated-agents.json'
import { readLockfile } from '../../../packages/core/src/agent-packages/lockfile'
import { getAgentState, type AgentState } from '../agent-packages/agent-state'
import { installPackage } from '../agent-packages/installer'
import { loadCuratedCatalog } from './curated-catalog'
import type { CheckResult, InstallResult, OnboardingComponent, OnboardingOptions } from './types'

export interface RecommendedAgent {
  id: string
  name: string
  description: string
  tags: readonly string[]
  source: string
  ref: string | null
  trust: 'official' | 'verified' | 'community'
  defaultSelected: boolean
}

interface CuratedAgentRow {
  id: string
  name: string
  description: string
  tags?: string[]
  source: string
  ref?: string | null
  trust?: 'official' | 'verified' | 'community'
  defaultSelected?: boolean
}

interface AgentInstallCandidate {
  agent: RecommendedAgent
  state: AgentState
}

function normalizeCatalog(rows: readonly CuratedAgentRow[]): RecommendedAgent[] {
  return rows
    .filter(agent => agent.trust === undefined || agent.trust === 'official')
    .map(agent => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      tags: agent.tags ?? [],
      source: agent.source,
      ref: agent.ref ?? null,
      trust: agent.trust ?? 'official',
      defaultSelected: agent.defaultSelected === true,
    }))
}

function staticCatalogAgents(): RecommendedAgent[] {
  const rows = (curatedCatalog as { agents?: CuratedAgentRow[] }).agents ?? []
  return normalizeCatalog(rows)
}

async function catalogAgents(): Promise<RecommendedAgent[]> {
  const catalog = await loadCuratedCatalog<{ agents?: CuratedAgentRow[] }>(
    curatedCatalog,
    '/data/curated-agents.json',
    'agents',
  )
  return normalizeCatalog(catalog.agents ?? [])
}

function sourceWithRef(source: string, ref: string | null): string {
  if (!ref) return source
  if (!source.startsWith('github:')) return source
  const hash = source.indexOf('#')
  if (hash === -1) return `${source}@${ref}`
  return `${source.slice(0, hash)}@${ref}${source.slice(hash)}`
}

function installedAgentIds(): Set<string> {
  const installed = new Set<string>()
  const lock = readLockfile()
  for (const entry of Object.values(lock.packages)) {
    if (entry.kind !== 'agent') continue
    if (entry.agentId) installed.add(entry.agentId)
  }
  return installed
}

async function agentCandidates(): Promise<AgentInstallCandidate[]> {
  const installed = installedAgentIds()
  const candidates: AgentInstallCandidate[] = []

  for (const agent of await catalogAgents()) {
    if (installed.has(agent.id)) continue
    const stateInfo = await getAgentState(agent.id)
    if (stateInfo.state === 'managed' || stateInfo.state === 'adopted') continue
    candidates.push({ agent, state: stateInfo.state })
  }

  return candidates
}

async function check(): Promise<CheckResult> {
  let candidates: AgentInstallCandidate[]
  try {
    candidates = await agentCandidates()
  } catch (err) {
    return {
      name: 'recommended-agents',
      status: 'error',
      message: `Failed to inspect official agents: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  if (candidates.length === 0) {
    const agents = await catalogAgents()
    return {
      name: 'recommended-agents',
      status: 'ok',
      message: 'Official agent packages are installed',
      details: { available: agents.map(agent => agent.id), missing: [] },
    }
  }

  const agents = await catalogAgents()
  const byId = new Map(candidates.map(candidate => [candidate.agent.id, candidate.state]))
  return {
    name: 'recommended-agents',
    status: 'missing',
    message: `${candidates.length} official agent package${candidates.length === 1 ? '' : 's'} not installed or adopted`,
    remediation: 'Select official agents during onboarding or later with `bakin agents install github:markhayden/bakin-bits-official#agents/<id> --adopt` for existing runtime agents.',
    details: {
      available: agents.map(agent => ({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        tags: agent.tags,
        source: agent.source,
        ref: agent.ref,
        trust: agent.trust,
        defaultSelected: agent.defaultSelected,
        state: byId.get(agent.id) ?? 'installed',
      })),
      missing: candidates.map(candidate => candidate.agent.id),
      adoptable: candidates.filter(candidate => candidate.state === 'unmanaged').map(candidate => candidate.agent.id),
    },
  }
}

async function install(opts: OnboardingOptions): Promise<InstallResult> {
  const start = Date.now()
  let candidates: AgentInstallCandidate[]
  try {
    candidates = await agentCandidates()
  } catch (err) {
    return {
      name: 'recommended-agents',
      status: 'failed',
      message: `Failed to inspect official agents: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    }
  }

  if (candidates.length === 0) {
    return {
      name: 'recommended-agents',
      status: 'noop',
      message: 'Official agent packages are already installed',
      durationMs: Date.now() - start,
    }
  }

  const explicitSelectedIds = opts.selectedRecommendedAgentIds
    ? new Set(opts.selectedRecommendedAgentIds)
    : null
  const selected = explicitSelectedIds
    ? candidates.filter(candidate => explicitSelectedIds.has(candidate.agent.id))
    : opts.autoApprove
      ? candidates.filter(candidate => candidate.agent.defaultSelected)
      : []

  if (selected.length === 0) {
    return {
      name: 'recommended-agents',
      status: 'skipped',
      message: 'No official agents selected',
      durationMs: Date.now() - start,
    }
  }

  const installed: string[] = []
  const adopted: string[] = []
  const failures: string[] = []
  for (const { agent, state } of selected) {
    try {
      opts.onProgress?.(state === 'unmanaged'
        ? `Adopting existing agent ${agent.id}`
        : `Installing official agent ${agent.id}`)
      await installPackage({
        source: sourceWithRef(agent.source, agent.ref),
        installAs: agent.id,
        adopt: state === 'unmanaged',
      })
      if (state === 'unmanaged') adopted.push(agent.id)
      else installed.push(agent.id)
    } catch (err) {
      failures.push(`${agent.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (failures.length > 0) {
    return {
      name: 'recommended-agents',
      status: 'failed',
      message: `Failed to install official agent${failures.length === 1 ? '' : 's'}: ${failures.join('; ')}`,
      durationMs: Date.now() - start,
    }
  }

  const parts = [
    installed.length > 0 ? `installed ${installed.join(', ')}` : null,
    adopted.length > 0 ? `adopted ${adopted.join(', ')}` : null,
  ].filter(Boolean)

  return {
    name: 'recommended-agents',
    status: 'installed',
    message: `Installed official agent package${selected.length === 1 ? '' : 's'}: ${parts.join('; ')}`,
    durationMs: Date.now() - start,
  }
}

export const recommendedAgentsComponent: OnboardingComponent = {
  name: 'recommended-agents',
  check,
  install,
}

export const RECOMMENDED_AGENTS = staticCatalogAgents()
