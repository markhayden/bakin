/**
 * Models plugin — server entry point.
 * API routes for model config, available models, aliases, and defaults.
 */
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execFile } from 'child_process'
import type { AgentModelConfig, AvailableModel } from './types'

const OPENCLAW_JSON = join(homedir(), '.openclaw', 'openclaw.json')
const AUTH_PROFILES = join(homedir(), '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json')
const OPENCLAW_BIN = process.env.OPENCLAW_PATH || '/opt/homebrew/bin/openclaw'

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
// Agent metadata fallback
// ---------------------------------------------------------------------------
const AGENT_META: Record<string, { name: string; emoji: string }> = {
  main: { name: 'Roscoe', emoji: '🐾' },
  patch: { name: 'Patch', emoji: '⚙️' },
  pixel: { name: 'Pixel', emoji: '🖼️' },
  rolo: { name: 'Rolo', emoji: '🎬' },
  basil: { name: 'Basil', emoji: '🥗' },
}

// ---------------------------------------------------------------------------
// Config read/write helpers
// ---------------------------------------------------------------------------
function readConfig(): OpenclawConfig {
  const raw = readFileSync(OPENCLAW_JSON, 'utf-8')
  const cleaned = raw.replace(/\/\/.*$/gm, '')
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
// Resolve agents from config
// ---------------------------------------------------------------------------
function resolveAgents(config: OpenclawConfig): AgentModelConfig[] {
  const defaultModel = config.agents.defaults.model.primary
  const defaultSubagentModel = config.agents.defaults.subagents?.model ?? null

  const agents = config.agents.list.map((agent) => {
    const id = agent.id === 'main' ? 'roscoe' : agent.id
    const meta = AGENT_META[agent.id] || {
      name: agent.identity?.name || agent.name || agent.id,
      emoji: agent.identity?.emoji || '🤖',
    }
    const ownModel = agent.model?.primary ?? null
    const subagentModel = agent.subagents?.model ?? null
    return {
      agentId: id,
      name: meta.name,
      emoji: meta.emoji,
      ownModel,
      subagentModel,
      defaultModel,
      defaultSubagentModel,
      effectiveModel: ownModel ?? defaultModel,
    }
  })

  // Sort: roscoe first, then alphabetically
  agents.sort((a, b) => {
    if (a.agentId === 'roscoe') return -1
    if (b.agentId === 'roscoe') return 1
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
  // "claude-sonnet-4-6-20250514" -> "Claude Sonnet 4.6"
  const base = id.replace(/-\d{8}$/, '') // strip date suffix
  const parts = base.split('-')
  // Capitalize each part, join with space
  const name = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
  // Fix version numbers: "4 6" -> "4.6", "4 5" -> "4.5"
  return name.replace(/(\d) (\d)/g, '$1.$2')
}

async function fetchAvailableModels(): Promise<{ models: AvailableModel[]; cached: boolean; cachedAt: number | null }> {
  // Check cache
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
      // Key is the model ID, value is config — the key itself is the alias target
      result[key] = key
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------
const modelsPlugin: BakinPlugin = {
  id: 'models',
  name: 'Models',
  version: '2.0.0',

  settingsSchema: {
    fields: [
      { key: 'showUsageMetrics', type: 'boolean', label: 'Show usage metrics', description: 'Display token usage and cost estimates', default: true },
      { key: 'defaultModel', type: 'select', label: 'Default model', description: 'Default model for new agents', options: [{ value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }, { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' }, { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' }], default: 'claude-sonnet-4-6' },
    ],
  },

  navItems: [
    { id: 'models', label: 'Models', icon: 'Cpu', href: '/models', order: 65 },
  ],

  activate(ctx: PluginContext) {
    // -----------------------------------------------------------------------
    // GET /api/plugins/models/available
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // GET /api/plugins/models/config
    // -----------------------------------------------------------------------
    ctx.registerRoute({
      path: '/config',
      method: 'GET',
      handler: async () => {
        try {
          const config = readConfig()
          const agents = resolveAgents(config)
          return Response.json({ agents })
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 })
        }
      },
    })

    // -----------------------------------------------------------------------
    // POST /api/plugins/models/config
    // -----------------------------------------------------------------------
    ctx.registerRoute({
      path: '/config',
      method: 'POST',
      handler: async (req: Request) => {
        try {
          const body = await req.json() as {
            agentId: string
            ownModel?: string | null
            subagentModel?: string | null
          }
          const { agentId } = body
          if (!agentId) {
            return Response.json({ error: 'agentId required' }, { status: 400 })
          }

          const ocId = agentId === 'roscoe' ? 'main' : agentId

          updateConfig((config) => {
            const agent = config.agents.list.find((a) => a.id === ocId)
            if (!agent) throw new Error(`Agent "${agentId}" not found`)

            if ('ownModel' in body) {
              if (body.ownModel) {
                agent.model = { primary: body.ownModel }
              } else {
                delete agent.model
              }
            }

            if ('subagentModel' in body) {
              if (body.subagentModel) {
                if (!agent.subagents) agent.subagents = {}
                agent.subagents.model = body.subagentModel
              } else if (agent.subagents) {
                delete agent.subagents.model
              }
            }
          })

          ctx.activity.audit('config.updated', 'system', { agentId: body.agentId, ownModel: body.ownModel, subagentModel: body.subagentModel })
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 })
        }
      },
    })

    // -----------------------------------------------------------------------
    // POST /api/plugins/models/defaults
    // -----------------------------------------------------------------------
    ctx.registerRoute({
      path: '/defaults',
      method: 'POST',
      handler: async (req: Request) => {
        try {
          const body = await req.json() as {
            defaultModel?: string
            defaultSubagentModel?: string | null
          }

          updateConfig((config) => {
            if (body.defaultModel) {
              config.agents.defaults.model.primary = body.defaultModel
            }
            if ('defaultSubagentModel' in body) {
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

          ctx.activity.audit('defaults.updated', 'system', { defaultModel: body.defaultModel, defaultSubagentModel: body.defaultSubagentModel })
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 })
        }
      },
    })

    // -----------------------------------------------------------------------
    // GET /api/plugins/models/aliases
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // POST /api/plugins/models/aliases
    // -----------------------------------------------------------------------
    ctx.registerRoute({
      path: '/aliases',
      method: 'POST',
      handler: async (req: Request) => {
        try {
          const body = await req.json() as
            | { aliases: Record<string, string> }
            | { action: 'add'; name: string; target: string }
            | { action: 'delete'; name: string }
            | { action: 'prepopulate' }

          updateConfig((config) => {
            if (!config.agents.defaults.models) {
              config.agents.defaults.models = {}
            }

            if ('aliases' in body) {
              // Full replacement
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
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 })
        }
      },
    })

    // -----------------------------------------------------------------------
    // POST /api/plugins/models/restart
    // -----------------------------------------------------------------------
    ctx.registerRoute({
      path: '/restart',
      method: 'POST',
      handler: async () => {
        return new Promise<Response>((resolve) => {
          execFile(OPENCLAW_BIN, ['gateway', 'restart'], (err) => {
            if (err) {
              resolve(Response.json({ ok: false, error: String(err) }, { status: 500 }))
            } else {
              ctx.activity.audit('gateway.restarted', 'system')
              resolve(Response.json({ ok: true, message: 'Restart initiated' }))
            }
          })
        })
      },
    })
  },
}

export default modelsPlugin
