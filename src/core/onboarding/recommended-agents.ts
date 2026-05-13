import curatedCatalog from '../../../packages/host/src/data/curated-agents.json'
import { readLockfile } from '../../../packages/core/src/agent-packages/lockfile'
import { installPackage } from '../agent-packages/installer'
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

function catalogAgents(): RecommendedAgent[] {
  const rows = (curatedCatalog as { agents?: CuratedAgentRow[] }).agents ?? []
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

function missingAgents(): RecommendedAgent[] {
  const installed = installedAgentIds()
  return catalogAgents().filter(agent => !installed.has(agent.id))
}

async function check(): Promise<CheckResult> {
  let missing: RecommendedAgent[]
  try {
    missing = missingAgents()
  } catch (err) {
    return {
      name: 'recommended-agents',
      status: 'error',
      message: `Failed to inspect official agents: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  if (missing.length === 0) {
    return {
      name: 'recommended-agents',
      status: 'ok',
      message: 'Official agent packages are installed',
      details: { available: catalogAgents().map(agent => agent.id), missing: [] },
    }
  }

  return {
    name: 'recommended-agents',
    status: 'missing',
    message: `${missing.length} official agent package${missing.length === 1 ? '' : 's'} not installed`,
    remediation: 'Select official agents during onboarding or later with `bakin agents install github:markhayden/bakin-bits-official#agents/<id>`.',
    details: {
      available: catalogAgents().map(agent => ({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        tags: agent.tags,
        source: agent.source,
        ref: agent.ref,
        trust: agent.trust,
        defaultSelected: agent.defaultSelected,
      })),
      missing: missing.map(agent => agent.id),
    },
  }
}

async function install(opts: OnboardingOptions): Promise<InstallResult> {
  const start = Date.now()
  let missing: RecommendedAgent[]
  try {
    missing = missingAgents()
  } catch (err) {
    return {
      name: 'recommended-agents',
      status: 'failed',
      message: `Failed to inspect official agents: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    }
  }

  if (missing.length === 0) {
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
    ? missing.filter(agent => explicitSelectedIds.has(agent.id))
    : opts.autoApprove
      ? missing.filter(agent => agent.defaultSelected)
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
  const failures: string[] = []
  for (const agent of selected) {
    try {
      await installPackage({
        source: sourceWithRef(agent.source, agent.ref),
        installAs: agent.id,
      })
      installed.push(agent.id)
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

  return {
    name: 'recommended-agents',
    status: 'installed',
    message: `Installed official agent package${installed.length === 1 ? '' : 's'}: ${installed.join(', ')}`,
    durationMs: Date.now() - start,
  }
}

export const recommendedAgentsComponent: OnboardingComponent = {
  name: 'recommended-agents',
  check,
  install,
}

export const RECOMMENDED_AGENTS = catalogAgents()
