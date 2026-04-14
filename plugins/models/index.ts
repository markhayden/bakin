/**
 * Models plugin — server entry point.
 * API routes for model config, available models, aliases, task profiles, and defaults.
 */
// Node builtins
import { readFileSync, writeFileSync } from 'fs'
import { execFile } from 'child_process'
// External
import { z } from 'zod'
// Internal
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
// Relative
import { getOpenClawPath } from '@bakin/core/openclaw-home'
import { tryGetMainAgentId } from '@bakin/core/main-agent'
import type { AgentModelConfig, AvailableModel, TaskProfile, ModelsPluginSettings } from './types'

const OPENCLAW_JSON = getOpenClawPath('openclaw.json')
const OPENCLAW_BIN = process.env.OPENCLAW_PATH || '/opt/homebrew/bin/openclaw'

// ---------------------------------------------------------------------------
// Gateway sync tracking (survives Next.js webpack re-evaluation)
// ---------------------------------------------------------------------------
interface GatewaySync { lastConfigChangeAt: number | null; lastRestartAt: number | null }
const gw = globalThis as typeof globalThis & { __bakinGatewaySync?: GatewaySync }
if (!gw.__bakinGatewaySync) gw.__bakinGatewaySync = { lastConfigChangeAt: null, lastRestartAt: null }
function getGatewaySync(): GatewaySync { return gw.__bakinGatewaySync! }
function markConfigDirty() { getGatewaySync().lastConfigChangeAt = Date.now() }
function markGatewayRestarted() { getGatewaySync().lastRestartAt = Date.now() }

// ---------------------------------------------------------------------------
// OpenClaw config types
// ---------------------------------------------------------------------------
interface OpenclawAgent {
  id: string
  name?: string
  identity?: { name?: string; emoji?: string }
  model?: { primary?: string }
  subagents?: { model?: string; allowAgents?: string[]; maxConcurrent?: number; [k: string]: unknown }
  [key: string]: unknown
}

interface OpenclawConfig {
  agents: {
    defaults: {
      model: { primary: string; fallbacks?: string[] }
      models?: Record<string, unknown>
      subagents?: { model?: string; [k: string]: unknown }
      [key: string]: unknown
    }
    list: OpenclawAgent[]
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
    const agents = await ctx.hooks.invoke<AgentMeta[]>('team.listAgents', {})
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
function readConfig(): OpenclawConfig {
  const raw = readFileSync(OPENCLAW_JSON, 'utf-8')
  // Strip whole-line // comments only (lines where // is the first non-whitespace).
  // Cannot naively strip mid-line // — it breaks URLs inside strings.
  const cleaned = raw.replace(/^\s*\/\/.*$/gm, '')
  return JSON.parse(cleaned)
}

function writeConfig(config: OpenclawConfig): void {
  writeFileSync(OPENCLAW_JSON, JSON.stringify(config, null, 2), 'utf-8')
}

function updateConfig(updater: (config: OpenclawConfig) => void): void {
  const config = readConfig()
  updater(config)
  writeConfig(config)
}

// ---------------------------------------------------------------------------
// Resolve agents from config + team hook metadata
// ---------------------------------------------------------------------------
async function resolveAgents(ctx: PluginContext): Promise<AgentModelConfig[]> {
  const config = readConfig()
  const teamAgents = await getAgentMeta(ctx)
  const defaultModel = config.agents.defaults.model.primary
  const defaultSubagentModel = config.agents.defaults.subagents?.model
    ? normalizeModelId(config.agents.defaults.subagents.model)
    : null

  const agents = config.agents.list.map((agent) => {
    // Resolve from team hook first, then OpenClaw identity, then ID
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

  // Sort: main agent first, then alphabetically
  const mainId = tryGetMainAgentId()
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
// Available models cache (globalThis-backed to survive Next.js webpack re-evaluation)
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

interface OpenClawModelListJson {
  models?: Array<{
    key?: string
    name?: string
    input?: string
    contextWindow?: number
    local?: boolean
    available?: boolean
    tags?: string[]
    missing?: boolean
  }>
}

async function loadConfiguredModelsFromOpenClaw(): Promise<AvailableModel[]> {
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(OPENCLAW_BIN, ['models', 'list', '--all', '--json'], { timeout: 30000 }, (err, out) => {
      if (err) {
        reject(err)
        return
      }
      resolve(out)
    })
  })
  const parsed = JSON.parse(stdout) as OpenClawModelListJson
  const config = readConfig()
  const defaultModel = normalizeModelId(config.agents.defaults.model.primary)
  const fallbackModels = (config.agents.defaults.model.fallbacks ?? []).map(normalizeModelId)

  return (parsed.models ?? [])
    .filter((model) => model.key && model.available === true && !model.missing)
    .map((model) => {
      const id = normalizeModelId(model.key!)
      const tags = model.tags ?? []
      const fallbackIndex = fallbackModels.indexOf(id)
      return {
        id,
        name: model.name || id,
        tier: tierFromId(id),
        provider: providerFromId(id),
        input: model.input,
        contextWindow: model.contextWindow,
        local: model.local,
        available: model.available ?? true,
        tags,
        configured: tags.includes('configured'),
        isDefault: id === defaultModel,
        fallbackIndex: fallbackIndex >= 0 ? fallbackIndex : null,
      }
    })
    .sort(sortModels)
}

async function fetchAvailableModels(): Promise<{ models: AvailableModel[]; cached: boolean; cachedAt: number | null }> {
  const cached = getModelsCache()
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return { models: cached.models, cached: true, cachedAt: cached.fetchedAt }
  }

  try {
    const models = await loadConfiguredModelsFromOpenClaw()
    const now = Date.now()
    setModelsCache({ models, fetchedAt: now })
    return { models, cached: false, cachedAt: now }
  } catch (err) {
    console.error('Failed to fetch models from OpenClaw:', err)
    return { models: fallbackModels(), cached: false, cachedAt: null }
  }
}

function fallbackModels(): AvailableModel[] {
  return [
    { id: 'openai-codex/gpt-5.4', name: 'GPT-5.4', tier: 'premium', provider: 'openai-codex', configured: true, isDefault: true, fallbackIndex: null, tags: ['default', 'configured'] },
    { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', tier: 'standard', provider: 'anthropic', configured: true, isDefault: false, fallbackIndex: 0, tags: ['fallback#1', 'configured'] },
    { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6', tier: 'premium', provider: 'anthropic', configured: true, isDefault: false, fallbackIndex: null, tags: ['configured'] },
    { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', tier: 'budget', provider: 'anthropic', configured: true, isDefault: false, fallbackIndex: null, tags: ['configured'] },
  ]
}

// ---------------------------------------------------------------------------
// Aliases helpers
// ---------------------------------------------------------------------------
const DEFAULT_ALIASES: Record<string, string> = {
  haiku: 'anthropic/claude-haiku-4-5',
  sonnet: 'anthropic/claude-sonnet-4-6',
  opus: 'anthropic/claude-opus-4-6',
}

function readAliases(config: OpenclawConfig): Record<string, string> {
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
// Task profiles defaults
// ---------------------------------------------------------------------------
const DEFAULT_TASK_PROFILES: TaskProfile[] = [
  { taskType: 'Heartbeat check', recommendedModel: 'claude-haiku-4-5-20251001', notes: 'Fast, cheap' },
  { taskType: 'Content writing', recommendedModel: 'claude-sonnet-4-6-20250514', notes: 'Quality output' },
  { taskType: 'Image brief', recommendedModel: 'claude-sonnet-4-6-20250514', notes: 'Creative' },
  { taskType: 'Video production', recommendedModel: 'claude-sonnet-4-6-20250514', notes: 'Creative' },
  { taskType: 'Code/development', recommendedModel: 'claude-opus-4-6-20250514', notes: 'Complex reasoning' },
  { taskType: 'Orchestration', recommendedModel: 'claude-sonnet-4-6-20250514', notes: 'Multi-step planning' },
]

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

const TaskProfileSchema = z.object({
  taskType: z.string().min(1),
  recommendedModel: z.string().min(1),
  notes: z.string(),
})

const TaskProfilesUpdateSchema = z.object({
  profiles: z.array(TaskProfileSchema),
})

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------
const modelsPlugin: BakinPlugin = {
  id: 'models',
  name: 'Models',
  version: '2.1.0',

  settingsSchema: {
    fields: [
      { key: 'showUsageMetrics', type: 'boolean', label: 'Show usage metrics', description: 'Display token usage and cost estimates', default: true },
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
    })

    ctx.hooks.register('models.getEffectiveModel', async (data: Record<string, unknown>) => {
      const agentId = data.agentId as string
      if (!agentId) return null
      const agents = await resolveAgents(ctx)
      const agent = agents.find((a) => a.agentId === agentId)
      return agent?.effectiveModel ?? null
    })

    ctx.hooks.register('models.markConfigDirty', () => { markConfigDirty() })

    ctx.hooks.register('models.markGatewayRestarted', () => { markGatewayRestarted() })

    ctx.hooks.register('models.getAvailableModels', async () => {
      const result = await fetchAvailableModels()
      return result.models
    })

    // -------------------------------------------------------------------
    // GET /api/plugins/models/available
    // -------------------------------------------------------------------
    ctx.registerRoute({
      path: '/available',
      method: 'GET',
      handler: async () => {
        try {
          const result = await fetchAvailableModels()
          return Response.json(result)
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // -------------------------------------------------------------------
    // GET /api/plugins/models/config
    // -------------------------------------------------------------------
    ctx.registerRoute({
      path: '/config',
      method: 'GET',
      handler: async () => {
        try {
          const agents = await resolveAgents(ctx)
          const config = readConfig()
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
    })

    // -------------------------------------------------------------------
    // POST /api/plugins/models/config
    // -------------------------------------------------------------------
    ctx.registerRoute({
      path: '/config',
      method: 'POST',
      handler: async (req: Request) => {
        try {
          const raw = await req.json()
          const body = ConfigUpdateSchema.parse(raw)
          const { agentId } = body

          // Capture old model for hook notification
          const agentsBefore = await resolveAgents(ctx)
          const before = agentsBefore.find((a) => a.agentId === agentId)
          const oldModel = before?.effectiveModel ?? null

          updateConfig((config) => {
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

          const agentsAfter = await resolveAgents(ctx)
          const after = agentsAfter.find((a) => a.agentId === agentId)
          const newModel = after?.effectiveModel ?? null

          markConfigDirty()
          setModelsCache(null)
          ctx.activity.audit('config.updated', 'system', { agentId, ownModel: body.ownModel, subagentModel: body.subagentModel })
          ctx.activity.log('system', `Updated model config for ${agentId}`, { category: 'models' })

          // Fire notification hook if model changed
          if (oldModel !== newModel) {
            try { await ctx.hooks.invoke('models.configChanged', { agentId, oldModel, newModel }) } catch { /* no subscribers */ }
          }

          return Response.json({ ok: true })
        } catch (err) {
          if (err instanceof z.ZodError) {
            return Response.json({ error: err.issues[0]?.message ?? 'Validation failed' }, { status: 400 })
          }
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // -------------------------------------------------------------------
    // POST /api/plugins/models/defaults
    // -------------------------------------------------------------------
    ctx.registerRoute({
      path: '/defaults',
      method: 'POST',
      handler: async (req: Request) => {
        try {
          const raw = await req.json()
          const body = DefaultsUpdateSchema.parse(raw)

          updateConfig((config) => {
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
          if (err instanceof z.ZodError) {
            return Response.json({ error: err.issues[0]?.message ?? 'Validation failed' }, { status: 400 })
          }
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // -------------------------------------------------------------------
    // GET /api/plugins/models/aliases
    // -------------------------------------------------------------------
    ctx.registerRoute({
      path: '/aliases',
      method: 'GET',
      handler: async () => {
        try {
          const config = readConfig()
          const aliases = readAliases(config)
          return Response.json({ aliases })
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // -------------------------------------------------------------------
    // POST /api/plugins/models/aliases
    // -------------------------------------------------------------------
    ctx.registerRoute({
      path: '/aliases',
      method: 'POST',
      handler: async (req: Request) => {
        try {
          const raw = await req.json()
          const body = AliasActionSchema.parse(raw)

          updateConfig((config) => {
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
          if (err instanceof z.ZodError) {
            return Response.json({ error: err.issues[0]?.message ?? 'Validation failed' }, { status: 400 })
          }
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // -------------------------------------------------------------------
    // GET /api/plugins/models/profiles
    // -------------------------------------------------------------------
    ctx.registerRoute({
      path: '/profiles',
      method: 'GET',
      handler: async () => {
        try {
          const settings = ctx.getSettings<ModelsPluginSettings>()
          const profiles = settings.taskProfiles ?? DEFAULT_TASK_PROFILES
          return Response.json({ profiles })
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // -------------------------------------------------------------------
    // PUT /api/plugins/models/profiles
    // -------------------------------------------------------------------
    ctx.registerRoute({
      path: '/profiles',
      method: 'PUT',
      handler: async (req: Request) => {
        try {
          const raw = await req.json()
          const body = TaskProfilesUpdateSchema.parse(raw)
          ctx.updateSettings({ taskProfiles: body.profiles })
          ctx.activity.audit('profiles.updated', 'system', { count: body.profiles.length })
          ctx.activity.log('system', `Updated ${body.profiles.length} task profiles`, { category: 'models' })
          return Response.json({ ok: true })
        } catch (err) {
          if (err instanceof z.ZodError) {
            return Response.json({ error: err.issues[0]?.message ?? 'Validation failed' }, { status: 400 })
          }
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // -------------------------------------------------------------------
    // GET /api/plugins/models/gateway/status
    // -------------------------------------------------------------------
    ctx.registerRoute({
      path: '/gateway/status',
      method: 'GET',
      description: 'Check if gateway config is out of sync (needs restart)',
      handler: async () => {
        const sync = getGatewaySync()
        const restartNeeded = sync.lastConfigChangeAt !== null &&
          (sync.lastRestartAt === null || sync.lastConfigChangeAt > sync.lastRestartAt)
        return Response.json({ restartNeeded, ...sync })
      },
    })

    // -------------------------------------------------------------------
    // POST /api/plugins/models/gateway/restart
    // -------------------------------------------------------------------
    ctx.registerRoute({
      path: '/gateway/restart',
      method: 'POST',
      handler: async () => {
        return new Promise<Response>((resolve) => {
          execFile(OPENCLAW_BIN, ['gateway', 'restart'], (err) => {
            if (err) {
              resolve(Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 }))
            } else {
              markGatewayRestarted()
              ctx.activity.audit('gateway.restarted', 'system')
              ctx.activity.log('system', 'OpenClaw gateway restarted', { category: 'models' })
              resolve(Response.json({ ok: true, message: 'Restart initiated' }))
            }
          })
        })
      },
    })

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
          const result = await fetchAvailableModels()
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
          const agents = await resolveAgents(ctx)
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
}

export default modelsPlugin
