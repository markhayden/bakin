/**
 * Models plugin — server entry point.
 * API routes for model config, available models, aliases, and defaults.
 */
// External
import { z } from 'zod'
// Internal
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin, defineRoute } from '@bakin/core/routing'
// Relative
import type { AgentModelConfig, AvailableModel, ModelsPluginSettings } from './types'
import {
  readPersistedCache,
  writePersistedCache,
  clearPersistedCache,
} from './lib/models-cache'
import { getKnownModel, getKnownProvider, formatCostRange, computeCostUsdMicros } from './data/known-models'
import { spendTotal, spendByAgent, spendByModel, LedgerUnavailableError } from '../../src/core/execution-ledger'
import { ORIGINS } from '../../src/core/model-routing'

// ---------------------------------------------------------------------------
// Runtime restart sync tracking (globalThis-backed so every reach into this module
// reads the same instance)
// ---------------------------------------------------------------------------
interface RuntimeSync { lastConfigChangeAt: number | null; lastRestartAt: number | null }
const runtimeSyncGlobal = globalThis as typeof globalThis & { __bakinRuntimeSync?: RuntimeSync }
if (!runtimeSyncGlobal.__bakinRuntimeSync) runtimeSyncGlobal.__bakinRuntimeSync = { lastConfigChangeAt: null, lastRestartAt: null }
function getRuntimeSync(): RuntimeSync { return runtimeSyncGlobal.__bakinRuntimeSync! }
function markConfigDirty() { getRuntimeSync().lastConfigChangeAt = Date.now() }
function markRuntimeRestarted() { getRuntimeSync().lastRestartAt = Date.now() }

// ---------------------------------------------------------------------------
// Runtime config types
// ---------------------------------------------------------------------------
interface RuntimeModelAgentConfig {
  id: string
  name?: string
  identity?: { name?: string; emoji?: string }
  model?: { primary?: string }
  subagents?: { model?: string; allowAgents?: string[]; maxConcurrent?: number; [k: string]: unknown }
  [key: string]: unknown
}

interface RuntimeModelConfig {
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
async function readConfig(ctx: PluginContext): Promise<RuntimeModelConfig> {
  return ctx.runtime.config.get<RuntimeModelConfig>()
}

async function writeConfig(ctx: PluginContext, config: RuntimeModelConfig, reason: string): Promise<void> {
  await ctx.runtime.config.replace(config, reason)
}

async function updateConfig(
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
async function resolveAgents(ctx: PluginContext): Promise<AgentModelConfig[]> {
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

// ---------------------------------------------------------------------------
// Available models cache (globalThis-backed so every reach into this module
// shares one cache instance)
// ---------------------------------------------------------------------------
interface ModelsCache { models: AvailableModel[]; fetchedAt: number }
const mc = globalThis as typeof globalThis & { __bakinModelsCache?: ModelsCache | null }
if (!mc.__bakinModelsCache) mc.__bakinModelsCache = null
function getModelsCache(): ModelsCache | null { return mc.__bakinModelsCache ?? null }
function setModelsCache(cache: ModelsCache | null) { mc.__bakinModelsCache = cache }
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

function tierFromId(id: string): 'budget' | 'standard' | 'premium' {
  if (id.includes('gpt-5') || id.includes('opus') || id.includes('pro')) return 'premium'
  if (id.includes('flash') || id.includes('haiku') || id.includes('mini')) return 'budget'
  if (id.includes('sonnet')) return 'standard'
  return 'budget'
}

function normalizeModelId(id: string): string {
  if (id.includes('/')) return id
  return id.startsWith('claude-') ? `anthropic/${id}` : id
}

function providerFromId(id: string): string {
  return id.split('/')[0] || 'other'
}

function sortModels(a: AvailableModel, b: AvailableModel): number {
  if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
  if ((a.isDefault ? 1 : 0) !== (b.isDefault ? 1 : 0)) return a.isDefault ? -1 : 1
  if ((a.fallbackIndex ?? 999) !== (b.fallbackIndex ?? 999)) return (a.fallbackIndex ?? 999) - (b.fallbackIndex ?? 999)
  if ((a.configured ? 1 : 0) !== (b.configured ? 1 : 0)) return a.configured ? -1 : 1
  return a.name.localeCompare(b.name)
}

async function loadConfiguredModelsFromRuntime(ctx: PluginContext): Promise<AvailableModel[]> {
  const runtimeModels = await ctx.runtime.models.listAvailable()
  const config = await readConfig(ctx as unknown as PluginContext)
  const defaultModel = normalizeModelId(config.agents.defaults.model.primary)
  const fallbackModels = (config.agents.defaults.model.fallbacks ?? []).map(normalizeModelId)

  return runtimeModels
    .filter((model) => model.id && model.available !== false)
    .map((model) => {
      const id = normalizeModelId(model.id)
      const tags = model.tags ?? []
      const fallbackIndex = fallbackModels.indexOf(id)
      const provider = providerFromId(id)
      const known = getKnownModel(id)
      const knownProvider = getKnownProvider(provider)
      return {
        id,
        name: known?.name ?? model.name ?? id,
        tier: known?.tier ?? tierFromId(id),
        provider,
        input: model.input,
        contextWindow: model.contextWindow,
        local: model.local,
        available: model.available ?? true,
        tags,
        configured: tags.includes('configured'),
        isDefault: id === defaultModel,
        fallbackIndex: fallbackIndex >= 0 ? fallbackIndex : null,
        // Enrichment from the curated catalog (plugins/models/data/known-models.ts).
        // Unknown models get none of these and render plain in the UI.
        description: known?.description,
        bestFor: known?.bestFor,
        // Display cost: literal for non-token-priced models, derived from
        // structured pricing for LLMs. Unknown models get neither.
        costRange: known?.costRange ?? (known?.pricing ? formatCostRange(known.pricing) : undefined),
        contextWindowDisplay: known?.contextWindow,
        kind: known?.kind,
        brandIconSlug: known?.brandIconSlug,
        providerLabel: knownProvider?.label,
        providerBrandIconSlug: knownProvider?.brandIconSlug,
        providerBrandColor: knownProvider?.brandColor,
      }
    })
    .sort(sortModels)
}

interface FetchResult {
  models: AvailableModel[]
  cached: boolean
  cachedAt: number | null
  stale: boolean
  error?: string
}

// In-flight promise dedupe — two concurrent /available requests on a
// cold-cold start would otherwise both ask the runtime for its complete
// model list, which can be slow. With this, the second caller awaits
// the first's result.
let inflightFetch: Promise<FetchResult> | null = null
let lastRuntimeModelFetchWarning: { message: string; at: number } | null = null
const MODEL_FETCH_WARNING_TTL = 60_000

function warnRuntimeModelFetchFailed(message: string): void {
  const now = Date.now()
  if (
    lastRuntimeModelFetchWarning &&
    lastRuntimeModelFetchWarning.message === message &&
    now - lastRuntimeModelFetchWarning.at < MODEL_FETCH_WARNING_TTL
  ) {
    return
  }
  lastRuntimeModelFetchWarning = { message, at: now }
  console.warn(`Failed to fetch models from runtime: ${message}`)
}

async function fetchAvailableModels(ctx: PluginContext): Promise<FetchResult> {
  // 1. Hot read — in-memory cache (fresh by TTL)
  const memCached = getModelsCache()
  if (memCached && Date.now() - memCached.fetchedAt < CACHE_TTL) {
    return { models: memCached.models, cached: true, cachedAt: memCached.fetchedAt, stale: false }
  }

  // 2. Persistent cache hydration — survives server restart even when
  //    in-memory is empty. Always returns last-known-good; `stale` tells
  //    the client whether to kick off a background refresh.
  const diskCached = memCached ? null : readPersistedCache()
  if (diskCached) {
    setModelsCache({ models: diskCached.models, fetchedAt: diskCached.fetchedAt })
    const stale = Date.now() - diskCached.fetchedAt >= CACHE_TTL
    return { models: diskCached.models, cached: true, cachedAt: diskCached.fetchedAt, stale }
  }

  // 3. No cache → live fetch. Dedupe concurrent callers against one
  //    in-flight promise. On success: write both caches. On failure:
  //    honest empty state — no fake data.
  if (inflightFetch) return inflightFetch
  inflightFetch = (async (): Promise<FetchResult> => {
    try {
      const models = await loadConfiguredModelsFromRuntime(ctx as unknown as PluginContext)
      const now = Date.now()
      setModelsCache({ models, fetchedAt: now })
      writePersistedCache({ models, fetchedAt: now, source: 'runtime' })
      return { models, cached: false, cachedAt: now, stale: false }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      warnRuntimeModelFetchFailed(message)
      return { models: [], cached: false, cachedAt: null, stale: false, error: message }
    } finally {
      inflightFetch = null
    }
  })()
  return inflightFetch
}

// ---------------------------------------------------------------------------
// Aliases helpers
// ---------------------------------------------------------------------------
const DEFAULT_ALIASES: Record<string, string> = {
  haiku: 'anthropic/claude-haiku-4-5',
  sonnet: 'anthropic/claude-sonnet-4-6',
  opus: 'anthropic/claude-opus-4-6',
}

function readAliases(config: RuntimeModelConfig): Record<string, string> {
  const raw = config.agents.defaults.models
  if (!raw || typeof raw !== 'object') return {}
  const result: Record<string, string> = {}
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val === 'string') {
      result[key] = val
    } else if (val && typeof val === 'object' && 'alias' in val) {
      result[key] = normalizeModelId((val as { alias: string }).alias)
    } else {
      result[key] = normalizeModelId(key)
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Zod schemas for request validation
// ---------------------------------------------------------------------------
const ConfigUpdateSchema = z.object({
  agentId: z.string().min(1, 'agentId required'),
  ownModel: z.string().nullable().optional(),
  subagentModel: z.string().nullable().optional(),
})

const DefaultsUpdateSchema = z.object({
  defaultModel: z.string().optional(),
  defaultSubagentModel: z.string().nullable().optional(),
  fallbackModels: z.array(z.string()).optional(),
})

const AliasActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), name: z.string().min(1), target: z.string().min(1) }),
  z.object({ action: z.literal('delete'), name: z.string().min(1) }),
  z.object({ action: z.literal('prepopulate') }),
]).or(z.object({ aliases: z.record(z.string(), z.string()) }))


// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------
const okResponse = z.object({ ok: z.literal(true) }).passthrough()
const errorResponse = z.object({ error: z.string() }).passthrough()
const passthrough = z.object({}).passthrough()

const ThinkingSettingSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max', 'inherit'])
const RoutingPolicySchema = z.object({
  origin: z.enum(ORIGINS as unknown as [string, ...string[]]),
  model: z.string().optional(),
  thinking: ThinkingSettingSchema.optional(),
})
const TagOverrideSchema = z.object({
  tag: z.string().min(1),
  model: z.string().optional(),
  thinking: ThinkingSettingSchema.optional(),
})
const RoutingConfigSchema = z.object({
  policies: z.array(RoutingPolicySchema),
  tagOverrides: z.array(TagOverrideSchema),
})

// Spend reporting windows. Coarser than the live-usage 5m/1h windows —
// spend is a daily/monthly story. 'all' = since the beginning of time.
type SpendWindow = '24h' | '7d' | '30d' | 'all'
const SPEND_WINDOW_MS: Record<Exclude<SpendWindow, 'all'>, number> = {
  '24h': 86_400_000,
  '7d': 604_800_000,
  '30d': 2_592_000_000,
}
function parseSpendWindow(raw: string | null): SpendWindow {
  return raw === '7d' || raw === '30d' || raw === 'all' ? raw : '24h'
}

// ---------------------------------------------------------------------------
// Routes (declarative)
// ---------------------------------------------------------------------------
const routes = [
  defineRoute({
    path: '/available',
    method: 'GET',
    summary: 'List available models',
    description: 'Returns the model catalog from the configured runtime adapter. Cached on disk; the response signals freshness.',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (_req, ctx) => {
      try {
        const result = await fetchAvailableModels(ctx as unknown as PluginContext)
        return Response.json(result)
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/refresh',
    method: 'POST',
    summary: 'Refresh model list (bypass cache)',
    description: 'Forces a fresh fetch from the runtime adapter, bypassing both cache layers. Falls back to last-known-good cache on failure.',
    body: { contentType: 'none' },
    responses: { 200: passthrough, 502: passthrough },
    handler: async (_req, ctx) => {
      try {
        const models = await loadConfiguredModelsFromRuntime(ctx as unknown as PluginContext)
        const now = Date.now()
        setModelsCache({ models, fetchedAt: now })
        writePersistedCache({ models, fetchedAt: now, source: 'runtime' })
        return Response.json({ ok: true, models, cached: false, cachedAt: now, stale: false })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const fallbackCache = readPersistedCache()
        if (fallbackCache) {
          return Response.json({
            ok: false,
            error: message,
            models: fallbackCache.models,
            cached: true,
            cachedAt: fallbackCache.fetchedAt,
            stale: true,
          }, { status: 502 })
        }
        return Response.json({
          ok: false,
          error: message,
          models: [],
          cached: false,
          cachedAt: null,
          stale: false,
        }, { status: 502 })
      }
    },
  }),

  defineRoute({
    path: '/config',
    method: 'GET',
    summary: 'Get model config',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (_req, ctx) => {
      try {
        const agents = await resolveAgents(ctx as unknown as PluginContext)
        const config = await readConfig(ctx as unknown as PluginContext)
        return Response.json({
          agents,
          defaultModel: normalizeModelId(config.agents.defaults.model.primary),
          defaultSubagentModel: config.agents.defaults.subagents?.model
            ? normalizeModelId(config.agents.defaults.subagents.model)
            : null,
          fallbackModels: (config.agents.defaults.model.fallbacks ?? []).map(normalizeModelId),
        })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/config',
    method: 'POST',
    summary: 'Update agent model config',
    body: ConfigUpdateSchema,
    responses: { 200: okResponse, 400: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      try {
        const { agentId } = body
        const agentsBefore = await resolveAgents(ctx as unknown as PluginContext)
        const before = agentsBefore.find((a) => a.agentId === agentId)
        const oldModel = before?.effectiveModel ?? null

        await updateConfig(ctx as unknown as PluginContext, 'models.update-agent-config', (config) => {
          const agent = config.agents.list.find((a) => a.id === agentId)
          if (!agent) throw new Error(`Agent "${agentId}" not found`)
          if (body.ownModel !== undefined) {
            if (body.ownModel) {
              agent.model = { primary: normalizeModelId(body.ownModel) }
            } else {
              delete agent.model
            }
          }
          if (body.subagentModel !== undefined) {
            if (body.subagentModel) {
              if (!agent.subagents) agent.subagents = {}
              agent.subagents.model = normalizeModelId(body.subagentModel)
            } else if (agent.subagents) {
              delete agent.subagents.model
            }
          }
        })

        const agentsAfter = await resolveAgents(ctx as unknown as PluginContext)
        const after = agentsAfter.find((a) => a.agentId === agentId)
        const newModel = after?.effectiveModel ?? null

        markConfigDirty()
        setModelsCache(null)
        ctx.activity.audit('config.updated', 'system', { agentId, ownModel: body.ownModel, subagentModel: body.subagentModel })
        ctx.activity.log('system', `Updated model config for ${agentId}`, { category: 'models' })

        if (oldModel !== newModel) {
          try { await ctx.hooks.invoke('models.configChanged', { agentId, oldModel, newModel }) } catch { /* no subscribers */ }
        }

        return Response.json({ ok: true })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/defaults',
    method: 'POST',
    summary: 'Update default models',
    body: DefaultsUpdateSchema,
    responses: { 200: okResponse, 400: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      try {
        await updateConfig(ctx as unknown as PluginContext, 'models.update-defaults', (config) => {
          if (body.defaultModel) {
            config.agents.defaults.model.primary = normalizeModelId(body.defaultModel)
          }
          if (body.fallbackModels) {
            const fallbackSet = body.fallbackModels
              .map(normalizeModelId)
              .filter((id) => id !== normalizeModelId(config.agents.defaults.model.primary))
            config.agents.defaults.model.fallbacks = [...new Set(fallbackSet)]
          }
          if (body.defaultSubagentModel !== undefined) {
            if (!config.agents.defaults.subagents) {
              config.agents.defaults.subagents = {}
            }
            if (body.defaultSubagentModel) {
              config.agents.defaults.subagents.model = body.defaultSubagentModel
            } else {
              delete config.agents.defaults.subagents.model
            }
          }
        })

        markConfigDirty()
        setModelsCache(null)
        ctx.activity.audit('defaults.updated', 'system', { defaultModel: body.defaultModel, defaultSubagentModel: body.defaultSubagentModel, fallbackModels: body.fallbackModels })
        ctx.activity.log('system', `Updated model defaults${body.defaultModel ? ` to ${body.defaultModel}` : ''}`, { category: 'models' })
        return Response.json({ ok: true })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/aliases',
    method: 'GET',
    summary: 'List model aliases',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (_req, ctx) => {
      try {
        const config = await readConfig(ctx as unknown as PluginContext)
        const aliases = readAliases(config)
        return Response.json({ aliases })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/aliases',
    method: 'POST',
    summary: 'Add/delete/prepopulate model aliases',
    body: AliasActionSchema,
    responses: { 200: okResponse, 400: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      try {
        await updateConfig(ctx as unknown as PluginContext, 'models.update-aliases', (config) => {
          if (!config.agents.defaults.models) {
            config.agents.defaults.models = {}
          }
          if ('aliases' in body) {
            const newModels: Record<string, unknown> = {}
            for (const [alias, target] of Object.entries(body.aliases)) {
              newModels[alias] = { alias: normalizeModelId(target) }
            }
            config.agents.defaults.models = newModels
          } else if ('action' in body) {
            if (body.action === 'add') {
              (config.agents.defaults.models as Record<string, unknown>)[body.name] = { alias: normalizeModelId(body.target) }
            } else if (body.action === 'delete') {
              delete (config.agents.defaults.models as Record<string, unknown>)[body.name]
            } else if (body.action === 'prepopulate') {
              const models = config.agents.defaults.models as Record<string, unknown>
              for (const [alias, target] of Object.entries(DEFAULT_ALIASES)) {
                if (!(alias in models)) {
                  models[alias] = { alias: target }
                }
              }
            }
          }
        })

        setModelsCache(null)
        ctx.activity.audit('aliases.updated', 'system')
        ctx.activity.log('system', 'Updated model aliases', { category: 'models' })
        return Response.json({ ok: true })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/routing',
    method: 'GET',
    summary: 'Per-turn model/thinking routing policy',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (_req, ctx) => {
      try {
        const settings = ctx.getSettings<ModelsPluginSettings>()
        return Response.json(settings.routing ?? { policies: [], tagOverrides: [] })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/routing',
    method: 'PUT',
    summary: 'Replace the routing policy',
    body: RoutingConfigSchema,
    responses: { 200: okResponse, 400: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      try {
        (ctx as unknown as PluginContext).updateSettings({ routing: body })
        ctx.activity.audit('routing.updated', 'system', { policies: body.policies.length, tagOverrides: body.tagOverrides.length })
        ctx.activity.log('system', `Updated routing policy (${body.policies.length} origins, ${body.tagOverrides.length} tag overrides)`, { category: 'models' })
        return Response.json({ ok: true })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/spend',
    method: 'GET',
    summary: 'Estimated agent spend over a window',
    description: 'Windowed token/cost rollups from the execution ledger (total, by agent, by model). Costs are estimates — cached-token discounts are not modeled.',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (req) => {
      try {
        const window = parseSpendWindow(new URL(req.url).searchParams.get('window'))
        const sinceMs = window === 'all' ? 0 : Date.now() - SPEND_WINDOW_MS[window]
        const byModel = spendByModel(sinceMs).map((r) => ({ ...r, model: r.model || 'unknown' }))
        return Response.json({
          window,
          estimated: true,
          totalUsdMicros: spendTotal({ sinceMs }),
          byAgent: spendByAgent(sinceMs),
          byModel,
        })
      } catch (err) {
        // A reporting read must not crash the page when the ledger is down.
        if (err instanceof LedgerUnavailableError) {
          return Response.json({ error: 'Spend ledger unavailable', totalUsdMicros: 0, byAgent: [], byModel: [] }, { status: 500 })
        }
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/runtime/status',
    method: 'GET',
    summary: 'Runtime config sync status',
    description: 'Reports whether the runtime config is out of sync with disk and needs a restart.',
    responses: { 200: passthrough },
    handler: async () => {
      const sync = getRuntimeSync()
      const restartNeeded = sync.lastConfigChangeAt !== null &&
        (sync.lastRestartAt === null || sync.lastConfigChangeAt > sync.lastRestartAt)
      return Response.json({ restartNeeded, ...sync })
    },
  }),

  defineRoute({
    path: '/runtime/restart',
    method: 'POST',
    summary: 'Restart the runtime',
    body: { contentType: 'none' },
    responses: { 200: okResponse, 500: errorResponse },
    handler: async (_req, ctx) => {
      try {
        await (ctx as unknown as PluginContext).runtime.restart()
        markRuntimeRestarted()
        setModelsCache(null)
        clearPersistedCache()
        ctx.activity.audit('runtime.restarted', 'system')
        ctx.activity.log('system', 'Runtime restarted', { category: 'models' })
        return Response.json({ ok: true, message: 'Restart initiated' })
      } catch (err) {
        return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),
]

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------
const modelsPlugin: BakinPlugin = definePlugin({
  id: 'models',
  name: 'Models',
  version: '2.1.0',
  routes,

  settingsSchema: {
    fields: [
      { key: 'defaultModel', type: 'select', label: 'Default model', description: 'Default model for new agents', options: [{ value: 'openai-codex/gpt-5.4', label: 'GPT-5.4' }, { value: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }, { value: 'anthropic/claude-opus-4-6', label: 'Claude Opus 4.6' }], default: 'openai-codex/gpt-5.4' },
    ],
  },

  // Nav items registered in client.tsx (order: 70) — no server-side duplication

  activate(ctx: PluginContext) {
    // -------------------------------------------------------------------
    // Hooks — cross-plugin communication
    // -------------------------------------------------------------------
    ctx.hooks.register('models.configChanged', () => {
      // Notification hook — handlers subscribe externally
    }, { label: 'Model config changed.', summary: 'Notifies listeners after an agent model assignment changes. Use it to refresh dependent state, update UI, or invalidate plugin caches that depend on model routing.', hookKind: 'event' })

    ctx.hooks.register('models.getEffectiveModel', async (data: Record<string, unknown>) => {
      const agentId = data.agentId as string
      if (!agentId) return null
      const agents = await resolveAgents(ctx as unknown as PluginContext)
      const agent = agents.find((a) => a.agentId === agentId)
      return agent?.effectiveModel ?? null
    }, { label: 'Get effective model.', summary: 'Resolves the model an agent will actually use after defaults, overrides, and provider settings are applied. Use it when a plugin needs runtime-ready model information for one agent.', hookKind: 'rpc' })

    ctx.hooks.register('models.markConfigDirty', () => { markConfigDirty() }, { label: 'Mark config dirty.', summary: 'Marks model configuration as changed so the runtime knows a refresh is needed. Use it after writing model settings that should not be treated as live yet.', hookKind: 'event' })

    ctx.hooks.register('models.markRuntimeRestarted', () => { markRuntimeRestarted() }, { label: 'Mark runtime refreshed.', summary: 'Records that the runtime has picked up the latest model configuration. Use it after restart or reload flows so stale dirty-state warnings can clear.', hookKind: 'event' })

    ctx.hooks.register('models.getAvailableModels', async () => {
      const result = await fetchAvailableModels(ctx as unknown as PluginContext)
      return result.models
    }, { label: 'List available models.', summary: 'Returns the model catalog available from the currently configured providers. Use it to populate pickers, validate assignments, or compare model options before saving config.', hookKind: 'rpc' })

    // Price one completed agent turn: resolve the model that ran (explicit
    // override → agent's effective model), look up catalog pricing, and
    // return an estimated micro-dollar cost. Cost is null when the model has
    // no catalog pricing (unmetered) — never fabricated. Core dispatch calls
    // this on settle so it stays pricing-agnostic (the models plugin owns
    // both per-agent model config and pricing).
    ctx.hooks.register('models.priceTurn', async (data: Record<string, unknown>) => {
      const agentId = data.agentId as string | undefined
      const explicit = data.model as string | undefined
      const input = typeof data.input === 'number' ? data.input : undefined
      const output = typeof data.output === 'number' ? data.output : undefined

      let model = explicit ? normalizeModelId(explicit) : null
      if (!model && agentId) {
        const agents = await resolveAgents(ctx as unknown as PluginContext)
        model = agents.find((a) => a.agentId === agentId)?.effectiveModel ?? null
      }
      const pricing = model ? getKnownModel(model)?.pricing : undefined
      const costUsdMicros = computeCostUsdMicros({ input, output }, pricing)
      return { model, costUsdMicros }
    }, { label: 'Price a turn.', summary: 'Resolves the model an agent turn ran on and returns an estimated cost in micro-dollars from the catalog pricing. Use it to attribute spend to a completed turn. Cost is null when the model is unpriced.', hookKind: 'rpc' })

    // Expose the per-turn routing policy to core dispatch, which resolves the
    // model/thinking for each turn before sending. Returns an empty config
    // when none is set → dispatch inherits the agent's configured model.
    ctx.hooks.register('models.getRoutingConfig', () => {
      const settings = ctx.getSettings<ModelsPluginSettings>()
      return settings.routing ?? { policies: [], tagOverrides: [] }
    }, { label: 'Get routing config.', summary: 'Returns the per-turn model/thinking routing policy (origins + tag overrides) that dispatch applies before each agent turn. Use it to read the current routing rules.', hookKind: 'rpc' })


    // -------------------------------------------------------------------
    // MCP Exec Tools — read-only agent access
    // -------------------------------------------------------------------
    ctx.registerExecTool({
      name: 'bakin_exec_models_list',
      label: 'Listed models',
      description: 'List available AI models with tier classification (budget/standard/premium). Use this to discover what models are available for assignment.',
      parameters: {
        tier: z.enum(['budget', 'standard', 'premium']).optional().describe('Filter by model tier'),
      },
      handler: async (params: Record<string, unknown>) => {
        try {
          const result = await fetchAvailableModels(ctx as unknown as PluginContext)
          const tier = params.tier as string | undefined
          const models = tier ? result.models.filter((m) => m.tier === tier) : result.models
          return { ok: true, models, cached: result.cached }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_models_get_config',
      label: 'Read model config',
      description: 'Get model configuration for all agents or a specific agent. Shows effective model (own override or default), subagent model, and system defaults.',
      parameters: {
        agentId: z.string().optional().describe('Specific agent ID to query (omit for all agents)'),
      },
      handler: async (params: Record<string, unknown>) => {
        try {
          const agents = await resolveAgents(ctx as unknown as PluginContext)
          const agentId = params.agentId as string | undefined
          if (agentId) {
            const agent = agents.find((a) => a.agentId === agentId)
            if (!agent) return { ok: false, error: `Agent "${agentId}" not found` }
            return { ok: true, agent }
          }
          return { ok: true, agents }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })
  },
}) as unknown as BakinPlugin

export default modelsPlugin
