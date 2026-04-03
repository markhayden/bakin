/**
 * Models plugin — server entry point.
 * API routes for model config, available models, aliases, task profiles, and defaults.
 */
// Node builtins
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execFile } from 'child_process'
// External
import { z } from 'zod'
// Internal
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
// Relative
import type { AgentModelConfig, AvailableModel, TaskProfile, ModelsPluginSettings } from './types'

const OPENCLAW_JSON = join(homedir(), '.openclaw', 'openclaw.json')
const AUTH_PROFILES = join(homedir(), '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json')
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
      model: { primary: string }
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
  const defaultSubagentModel = config.agents.defaults.subagents?.model ?? null

  const agents = config.agents.list.map((agent) => {
    const bakinId = agent.id === 'main' ? 'main-operator' : agent.id
    // Resolve from team hook first, then OpenClaw identity, then ID
    const teamAgent = teamAgents.find((a) => a.id === bakinId)
    const rawName = teamAgent?.name || agent.identity?.name || agent.name || agent.id
    // Capitalize raw IDs that look like slugs (e.g. 'main-operator' → 'Main Operator')
    const name = rawName === rawName.toLowerCase() && !rawName.includes(' ')
      ? rawName.charAt(0).toUpperCase() + rawName.slice(1)
      : rawName
    const emoji = teamAgent?.emoji || agent.identity?.emoji || '🤖'

    const ownModel = agent.model?.primary ?? null
    const subagentModel = agent.subagents?.model ?? null
    return {
      agentId: bakinId,
      name,
      emoji,
      ownModel,
      subagentModel,
      defaultModel,
      defaultSubagentModel,
      effectiveModel: ownModel ?? defaultModel,
    }
  })

  // Sort: main-operator first, then alphabetically
  agents.sort((a, b) => {
    if (a.agentId === 'main-operator') return -1
    if (b.agentId === 'main-operator') return 1
    return a.name.localeCompare(b.name)
  })

  return agents
}

// ---------------------------------------------------------------------------
// Available models cache
// ---------------------------------------------------------------------------
let modelsCache: { models: AvailableModel[]; fetchedAt: number } | null = null
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

function getAnthropicKey(): string | null {
  try {
    const raw = readFileSync(AUTH_PROFILES, 'utf-8')
    const data = JSON.parse(raw)
    return data.profiles?.['anthropic:default']?.token ?? null
  } catch {
    return null
  }
}

function tierFromId(id: string): 'budget' | 'standard' | 'premium' {
  if (id.includes('opus')) return 'premium'
  if (id.includes('sonnet')) return 'standard'
  return 'budget'
}

function displayNameFromId(id: string): string {
  const base = id.replace(/-\d{8}$/, '')
  const parts = base.split('-')
  const name = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
  return name.replace(/(\d) (\d)/g, '$1.$2')
}

async function fetchAvailableModels(): Promise<{ models: AvailableModel[]; cached: boolean; cachedAt: number | null }> {
  if (modelsCache && Date.now() - modelsCache.fetchedAt < CACHE_TTL) {
    return { models: modelsCache.models, cached: true, cachedAt: modelsCache.fetchedAt }
  }

  const apiKey = getAnthropicKey()
  if (!apiKey) {
    return { models: fallbackModels(), cached: false, cachedAt: null }
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    })

    if (!res.ok) {
      console.error(`Anthropic models API returned ${res.status}`)
      return { models: fallbackModels(), cached: false, cachedAt: null }
    }

    const data = await res.json() as { data?: Array<{ id: string; display_name?: string }> }
    const allModels = data.data ?? []
    const claudeModels = allModels
      .filter((m) => m.id.startsWith('claude-'))
      .map((m) => ({
        id: m.id,
        name: m.display_name || displayNameFromId(m.id),
        tier: tierFromId(m.id),
      }))
      .sort((a, b) => {
        const tierOrder = { premium: 0, standard: 1, budget: 2 }
        const td = tierOrder[a.tier] - tierOrder[b.tier]
        if (td !== 0) return td
        return a.name.localeCompare(b.name)
      })

    modelsCache = { models: claudeModels, fetchedAt: Date.now() }
    return { models: claudeModels, cached: false, cachedAt: modelsCache.fetchedAt }
  } catch (err) {
    console.error('Failed to fetch models from Anthropic:', err)
    return { models: fallbackModels(), cached: false, cachedAt: null }
  }
}

function fallbackModels(): AvailableModel[] {
  return [
    { id: 'claude-opus-4-6-20250514', name: 'Claude Opus 4.6', tier: 'premium' },
    { id: 'claude-sonnet-4-6-20250514', name: 'Claude Sonnet 4.6', tier: 'standard' },
    { id: 'claude-sonnet-4-5-20250414', name: 'Claude Sonnet 4.5', tier: 'standard' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', tier: 'budget' },
  ]
}

// ---------------------------------------------------------------------------
// Aliases helpers
// ---------------------------------------------------------------------------
const DEFAULT_ALIASES: Record<string, string> = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
}

function readAliases(config: OpenclawConfig): Record<string, string> {
  const raw = config.agents.defaults.models
  if (!raw || typeof raw !== 'object') return {}
  const result: Record<string, string> = {}
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val === 'string') {
      result[key] = val
    } else if (val && typeof val === 'object' && 'alias' in val) {
      result[key] = (val as { alias: string }).alias
    } else {
      result[key] = key
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
      { key: 'defaultModel', type: 'select', label: 'Default model', description: 'Default model for new agents', options: [{ value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }, { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' }, { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' }], default: 'claude-sonnet-4-6' },
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
          return Response.json({ error: String(err) }, { status: 500 })
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
          return Response.json({ agents })
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 })
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

          const ocId = agentId === 'main-operator' ? 'main' : agentId

          // Capture old model for hook notification
          const agentsBefore = await resolveAgents(ctx)
          const before = agentsBefore.find((a) => a.agentId === agentId)
          const oldModel = before?.effectiveModel ?? null

          updateConfig((config) => {
            const agent = config.agents.list.find((a) => a.id === ocId)
            if (!agent) throw new Error(`Agent "${agentId}" not found`)

            if (body.ownModel !== undefined) {
              if (body.ownModel) {
                agent.model = { primary: body.ownModel }
              } else {
                delete agent.model
              }
            }

            if (body.subagentModel !== undefined) {
              if (body.subagentModel) {
                if (!agent.subagents) agent.subagents = {}
                agent.subagents.model = body.subagentModel
              } else if (agent.subagents) {
                delete agent.subagents.model
              }
            }
          })

          const agentsAfter = await resolveAgents(ctx)
          const after = agentsAfter.find((a) => a.agentId === agentId)
          const newModel = after?.effectiveModel ?? null

          markConfigDirty()
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
          return Response.json({ error: String(err) }, { status: 500 })
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
              config.agents.defaults.model.primary = body.defaultModel
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
          ctx.activity.audit('defaults.updated', 'system', { defaultModel: body.defaultModel, defaultSubagentModel: body.defaultSubagentModel })
          ctx.activity.log('system', `Updated default model${body.defaultModel ? ` to ${body.defaultModel}` : ''}`, { category: 'models' })
          return Response.json({ ok: true })
        } catch (err) {
          if (err instanceof z.ZodError) {
            return Response.json({ error: err.issues[0]?.message ?? 'Validation failed' }, { status: 400 })
          }
          return Response.json({ error: String(err) }, { status: 500 })
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
          return Response.json({ error: String(err) }, { status: 500 })
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
                newModels[alias] = { alias: target }
              }
              config.agents.defaults.models = newModels
            } else if ('action' in body) {
              if (body.action === 'add') {
                (config.agents.defaults.models as Record<string, unknown>)[body.name] = { alias: body.target }
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

          ctx.activity.audit('aliases.updated', 'system')
          ctx.activity.log('system', 'Updated model aliases', { category: 'models' })
          return Response.json({ ok: true })
        } catch (err) {
          if (err instanceof z.ZodError) {
            return Response.json({ error: err.issues[0]?.message ?? 'Validation failed' }, { status: 400 })
          }
          return Response.json({ error: String(err) }, { status: 500 })
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
          return Response.json({ error: String(err) }, { status: 500 })
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
          return Response.json({ error: String(err) }, { status: 500 })
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
              resolve(Response.json({ ok: false, error: String(err) }, { status: 500 }))
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
          return { ok: false, error: String(err) }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_models_get_config',
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
          return { ok: false, error: String(err) }
        }
      },
    })
  },
}

export default modelsPlugin
