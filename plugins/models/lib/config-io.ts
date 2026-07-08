/**
 * Agent/model resolution over the runtime-neutral contract (P2.3).
 *
 * The old read/write/update helpers over raw runtime config are GONE — model
 * routing policy lives runtime-side behind `ctx.runtime.models.routingPolicy()
 * / setRoutingPolicy()`, and per-agent assignments ride `agents.list()` /
 * `agents.update()`. This module keeps the team-hook agent-metadata cache and
 * `resolveAgents` (runtime roster + policy → per-agent effective models).
 *
 * Also owns the runtime restart-sync cell: `markConfigDirty` /
 * `markRuntimeRestarted` record whether the runtime has picked up the latest
 * routing write. globalThis-backed so every reach into this module reads the
 * same instance — and kept in exactly this ONE module.
 */
import type { PluginContext } from '@bakin/core/plugin-types'
import { selectRuntimeMainAgent } from '@bakin/core/adapters/runtime'

import type { AgentModelConfig } from '../types'
import { normalizeModelId } from './model-id'

// ---------------------------------------------------------------------------
// Runtime restart sync tracking (globalThis-backed so every reach into this module
// reads the same instance)
// ---------------------------------------------------------------------------
interface RuntimeSync { lastConfigChangeAt: number | null; lastRestartAt: number | null }
const runtimeSyncGlobal = globalThis as typeof globalThis & { __bakinRuntimeSync?: RuntimeSync }
if (!runtimeSyncGlobal.__bakinRuntimeSync) runtimeSyncGlobal.__bakinRuntimeSync = { lastConfigChangeAt: null, lastRestartAt: null }
export function getRuntimeSync(): RuntimeSync { return runtimeSyncGlobal.__bakinRuntimeSync! }
export function markConfigDirty() { getRuntimeSync().lastConfigChangeAt = Date.now() }
export function markRuntimeRestarted() { getRuntimeSync().lastRestartAt = Date.now() }

// ---------------------------------------------------------------------------
// Agent metadata from team hook (cached)
// ---------------------------------------------------------------------------
interface AgentMeta { id: string; name: string; emoji: string }
let agentMetaCache: { agents: AgentMeta[]; fetchedAt: number } | null = null
const META_CACHE_TTL = 30_000 // 30s

async function getAgentMeta(ctx: PluginContext): Promise<AgentMeta[]> {
  if (agentMetaCache && Date.now() - agentMetaCache.fetchedAt < META_CACHE_TTL) {
    return agentMetaCache.agents
  }
  try {
    const agents = await ctx.hooks.invoke<AgentMeta[]>('team.list', {})
    if (agents && Array.isArray(agents)) {
      agentMetaCache = { agents, fetchedAt: Date.now() }
      return agents
    }
  } catch {
    // team plugin may not be loaded yet
  }
  return []
}

// ---------------------------------------------------------------------------
// Resolve agents from the runtime roster + routing policy + team metadata
// ---------------------------------------------------------------------------
export async function resolveAgents(ctx: PluginContext): Promise<AgentModelConfig[]> {
  const [runtimeAgents, policy, teamAgents] = await Promise.all([
    ctx.runtime.agents.list(),
    ctx.runtime.models.routingPolicy(),
    getAgentMeta(ctx),
  ])
  const defaultModel = policy.defaultModel
  const defaultSubagentModel = policy.defaultSubagentModel
    ? normalizeModelId(policy.defaultSubagentModel)
    : null

  const agents = runtimeAgents.map((agent) => {
    // Resolve from team hook first, then runtime identity, then ID
    const teamAgent = teamAgents.find((a) => a.id === agent.id)
    const rawName = teamAgent?.name || agent.name || agent.id
    // Capitalize raw IDs that look like slugs (e.g. 'main' → 'Main')
    const name = rawName === rawName.toLowerCase() && !rawName.includes(' ')
      ? rawName.charAt(0).toUpperCase() + rawName.slice(1)
      : rawName
    const emoji = teamAgent?.emoji || String(agent.metadata?.emoji ?? '') || '🤖'

    const ownModel = agent.model ? normalizeModelId(agent.model) : null
    const subagentModel = agent.subagentModel ? normalizeModelId(agent.subagentModel) : null
    return {
      agentId: agent.id,
      name,
      emoji,
      ownModel,
      subagentModel,
      defaultModel: normalizeModelId(defaultModel),
      defaultSubagentModel,
      effectiveModel: ownModel ?? normalizeModelId(defaultModel),
    }
  })

  // Sort the runtime's orchestrator first, then alphabetically.
  const mainId = selectRuntimeMainAgent(runtimeAgents)?.id ?? null
  agents.sort((a, b) => {
    if (mainId) {
      if (a.agentId === mainId) return -1
      if (b.agentId === mainId) return 1
    }
    return a.name.localeCompare(b.name)
  })

  return agents
}
