/**
 * Core models module for Beacon.
 * Handles model resolution, configuration, and available models caching.
 * This is core (not plugin) because model selection affects all agents.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { createLogger } from './logger'
import { getSettings } from './settings'
import * as vault from './vault'

const log = createLogger('models')

const OPENCLAW_JSON = join(homedir(), '.openclaw', 'openclaw.json')

// ---------------------------------------------------------------------------
// OpenClaw config types
// ---------------------------------------------------------------------------
interface OpenclawAgent {
  id: string
  name?: string
  identity?: { name?: string; emoji?: string }
  model?: { primary?: string }
  subagents?: { model?: string; [k: string]: unknown }
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

export interface AgentModelConfig {
  agentId: string
  name: string
  emoji: string
  ownModel: string | null
  subagentModel: string | null
  defaultModel: string
  defaultSubagentModel: string | null
  effectiveModel: string
}

export interface AvailableModel {
  id: string
  name: string
  tier: 'budget' | 'standard' | 'premium'
}

// ---------------------------------------------------------------------------
// Config read/write
// ---------------------------------------------------------------------------
export function readConfig(): OpenclawConfig {
  const raw = readFileSync(OPENCLAW_JSON, 'utf-8')
  const cleaned = raw.replace(/\/\/.*$/gm, '')
  return JSON.parse(cleaned)
}

export function writeConfig(config: OpenclawConfig): void {
  writeFileSync(OPENCLAW_JSON, JSON.stringify(config, null, 2), 'utf-8')
}

export function updateConfig(updater: (config: OpenclawConfig) => void): void {
  const config = readConfig()
  updater(config)
  writeConfig(config)
}

// ---------------------------------------------------------------------------
// Agent metadata
// ---------------------------------------------------------------------------
const AGENT_META: Record<string, { name: string; emoji: string }> = {
  main: { name: 'Roscoe', emoji: '🐾' },
  patch: { name: 'Patch', emoji: '⚙️' },
  pixel: { name: 'Pixel', emoji: '🖼️' },
  rolo: { name: 'Rolo', emoji: '🎬' },
  basil: { name: 'Basil', emoji: '🥗' },
  scout: { name: 'Scout', emoji: '🔍' },
  nemo: { name: 'Nemo', emoji: '🐠' },
  zen: { name: 'Zen', emoji: '🧘' },
}

// ---------------------------------------------------------------------------
// Agent resolution
// ---------------------------------------------------------------------------
export function resolveAgents(config?: OpenclawConfig): AgentModelConfig[] {
  const cfg = config || readConfig()
  const defaultModel = cfg.agents.defaults.model.primary
  const defaultSubagentModel = cfg.agents.defaults.subagents?.model ?? null

  const agents = cfg.agents.list.map((agent) => {
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

  agents.sort((a, b) => {
    if (a.agentId === 'roscoe') return -1
    if (b.agentId === 'roscoe') return 1
    return a.name.localeCompare(b.name)
  })

  return agents
}

/**
 * Check if a model is allowed by the settings allowlist/blocklist.
 */
export function isModelAllowed(modelId: string): boolean {
  const settings = getSettings()
  if (settings.models.blocklist?.length) {
    if (settings.models.blocklist.some(b => modelId.includes(b))) return false
  }
  if (settings.models.allowlist?.length) {
    return settings.models.allowlist.some(a => modelId.includes(a))
  }
  return true
}

// ---------------------------------------------------------------------------
// Available models cache
// ---------------------------------------------------------------------------
let modelsCache: { models: AvailableModel[]; fetchedAt: number } | null = null
const CACHE_TTL = 60 * 60 * 1000

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

export async function fetchAvailableModels(): Promise<{ models: AvailableModel[]; cached: boolean; cachedAt: number | null }> {
  if (modelsCache && Date.now() - modelsCache.fetchedAt < CACHE_TTL) {
    return { models: modelsCache.models, cached: true, cachedAt: modelsCache.fetchedAt }
  }

  const apiKey = vault.get('anthropic-api-key')
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
      log.error(`Anthropic models API returned ${res.status}`)
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
    log.error('Failed to fetch models from Anthropic', err)
    return { models: fallbackModels(), cached: false, cachedAt: null }
  }
}

export function fallbackModels(): AvailableModel[] {
  return [
    { id: 'claude-opus-4-6-20250514', name: 'Claude Opus 4.6', tier: 'premium' },
    { id: 'claude-sonnet-4-6-20250514', name: 'Claude Sonnet 4.6', tier: 'standard' },
    { id: 'claude-sonnet-4-5-20250414', name: 'Claude Sonnet 4.5', tier: 'standard' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', tier: 'budget' },
  ]
}

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------
export const DEFAULT_ALIASES: Record<string, string> = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
}

export function readAliases(config?: OpenclawConfig): Record<string, string> {
  const cfg = config || readConfig()
  const raw = cfg.agents.defaults.models
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
