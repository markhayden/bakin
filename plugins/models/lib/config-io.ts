/**
 * Runtime model-config I/O + agent resolution.
 *
 * Extracted from index.ts. The read/write/update helpers over the runtime
 * config (through src/core/runtime-config's allowlisted gate), the
 * RuntimeModelConfig shape, the team-hook agent-metadata cache, and
 * `resolveAgents` (config + team metadata → per-agent effective models).
 *
 * Also owns the runtime restart-sync cell: `markConfigDirty` /
 * `markRuntimeRestarted` record whether the runtime has picked up the latest
 * config write. globalThis-backed so every reach into this module reads the
 * same instance — and kept in exactly this ONE module.
 */
import type { PluginContext } from '@bakin/core/plugin-types'

import type { AgentModelConfig } from '../types'
import { readRuntimeConfig, replaceRuntimeConfig } from '../../../src/core/runtime-config'
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
// Runtime config types
// ---------------------------------------------------------------------------
export interface RuntimeModelAgentConfig {
  id: string
  name?: string
  identity?: { name?: string; emoji?: string }
  model?: { primary?: string }
  subagents?: { model?: string; allowAgents?: string[]; maxConcurrent?: number; [k: string]: unknown }
  [key: string]: unknown
}

export interface RuntimeModelConfig {
  agents: {
    defaults: {
      model: { primary: string; fallbacks?: string[] }
      models?: Record<string, unknown>
      subagents?: { model?: string; [k: string]: unknown }
      [key: string]: unknown
    }
    list: RuntimeModelAgentConfig[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

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
// Config read/write helpers
// ---------------------------------------------------------------------------
export async function readConfig(ctx: PluginContext): Promise<RuntimeModelConfig> {
  const raw = await readRuntimeConfig<Partial<RuntimeModelConfig>>(ctx.runtime, 'models.routing')
  return withModelConfigSkeleton(raw)
}

/**
 * Runtimes whose config doesn't carry OpenClaw's `agents.defaults` shape
 * (Pi) previously crashed every models-plugin read ("undefined is not an
 * object evaluating config.agents.defaults" — Pi live-smoke finding).
 * Guarantee the skeleton instead: the models list renders without
 * default/fallback flags and per-agent overrides are simply absent —
 * honest degradation, never a crash.
 */
function withModelConfigSkeleton(raw: Partial<RuntimeModelConfig>): RuntimeModelConfig {
  const agents = (raw.agents ?? {}) as Partial<RuntimeModelConfig['agents']>
  const defaults = (agents.defaults ?? {}) as Partial<RuntimeModelConfig['agents']['defaults']>
  return {
    ...raw,
    agents: {
      ...agents,
      list: agents.list ?? [],
      defaults: {
        ...defaults,
        model: {
          primary: defaults.model?.primary ?? '',
          fallbacks: defaults.model?.fallbacks ?? [],
        },
        models: defaults.models ?? {},
      },
    },
  }
}

export async function writeConfig(ctx: PluginContext, config: RuntimeModelConfig, reason: string): Promise<void> {
  await replaceRuntimeConfig(ctx.runtime, config, 'models.routing', reason)
}

export async function updateConfig(
  ctx: PluginContext,
  reason: string,
  updater: (config: RuntimeModelConfig) => void,
): Promise<void> {
  const config = await readConfig(ctx as unknown as PluginContext)
  updater(config)
  await writeConfig(ctx, config, reason)
}

// ---------------------------------------------------------------------------
// Resolve agents from config + team hook metadata
// ---------------------------------------------------------------------------
export async function resolveAgents(ctx: PluginContext): Promise<AgentModelConfig[]> {
  const config = await readConfig(ctx as unknown as PluginContext)
  const teamAgents = await getAgentMeta(ctx)
  const defaultModel = config.agents.defaults.model.primary
  const defaultSubagentModel = config.agents.defaults.subagents?.model
    ? normalizeModelId(config.agents.defaults.subagents.model)
    : null

  const agents = config.agents.list.map((agent) => {
    // Resolve from team hook first, then runtime identity, then ID
    const teamAgent = teamAgents.find((a) => a.id === agent.id)
    const rawName = teamAgent?.name || agent.identity?.name || agent.name || agent.id
    // Capitalize raw IDs that look like slugs (e.g. 'main' → 'Main')
    const name = rawName === rawName.toLowerCase() && !rawName.includes(' ')
      ? rawName.charAt(0).toUpperCase() + rawName.slice(1)
      : rawName
    const emoji = teamAgent?.emoji || agent.identity?.emoji || '🤖'

    const ownModel = agent.model?.primary ? normalizeModelId(agent.model.primary) : null
    const subagentModel = agent.subagents?.model ? normalizeModelId(agent.subagents.model) : null
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

  // Sort the canonical orchestrator first when the runtime config exposes one,
  // then alphabetically for every other runtime agent.
  const mainId = config.agents.list.some((agent) => agent.id === 'main') ? 'main' : null
  agents.sort((a, b) => {
    if (mainId) {
      if (a.agentId === mainId) return -1
      if (b.agentId === mainId) return 1
    }
    return a.name.localeCompare(b.name)
  })

  return agents
}
