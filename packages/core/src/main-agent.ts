/**
 * Main agent (orchestrator) resolution for Bakin.
 *
 * The orchestrator id is NOT hardcoded. It resolves dynamically per install:
 *   1. `settings.mainAgentId` from ~/.bakin/settings.json (set by `bakin onboard`)
 *   2. Auto-detect from OpenClaw: the agent whose `workspace` equals
 *      `agents.defaults.workspace` (subagents override with per-agent paths).
 *   3. Fallback: the first agent in `agents.list` with a populated
 *      `subagents.allowAgents` listing (covers configs where the orchestrator
 *      inherits the default workspace instead of setting it explicitly).
 *
 * If nothing resolves, throws — the caller should run onboarding or set
 * `mainAgentId` in settings.json. Display names come from `identity.name`.
 */
import { readFileSync } from 'fs'

import { getSettings } from './settings'
import { getOpenClawPath } from './openclaw-home'

interface OpenClawAgentEntry {
  id: string
  workspace?: string
  identity?: { name?: string; emoji?: string }
  subagents?: { allowAgents?: string[] }
}

interface OpenClawConfig {
  agents?: {
    defaults?: { workspace?: string }
    list?: OpenClawAgentEntry[]
  }
}

export function getMainAgentId(): string {
  const id = tryGetMainAgentId()
  if (id) return id
  throw new Error(
    'Cannot resolve main agent id. Set `mainAgentId` in ~/.bakin/settings.json ' +
    'or run `bakin onboard` to detect it from OpenClaw.'
  )
}

/**
 * Non-throwing variant for call sites that have a sensible degraded behavior
 * (e.g. sort order, optional UI defaults, diagnostic logging).
 */
export function tryGetMainAgentId(): string | null {
  const settings = getSettings()
  const fromSettings = settings.mainAgentId
  if (typeof fromSettings === 'string' && fromSettings) return fromSettings

  return detectOrchestratorFromOpenClaw()
}

export function getMainAgentName(): string {
  const id = getMainAgentId()
  const entry = findOpenClawAgentById(id)
  const name = entry?.identity?.name
  if (typeof name === 'string' && name.trim().length > 0) return name
  return id.charAt(0).toUpperCase() + id.slice(1)
}

function detectOrchestratorFromOpenClaw(): string | null {
  const config = readOpenClawConfig()
  if (!config) return null
  const list = config.agents?.list
  if (!Array.isArray(list) || list.length === 0) return null

  const defaultWorkspace = config.agents?.defaults?.workspace
  if (typeof defaultWorkspace === 'string' && defaultWorkspace) {
    const workspaceMatch = list.find((a) => a.workspace === defaultWorkspace)
    if (workspaceMatch) return workspaceMatch.id
  }

  const withSubagents = list.find(
    (a) => Array.isArray(a.subagents?.allowAgents) && (a.subagents?.allowAgents?.length ?? 0) > 0
  )
  return withSubagents?.id ?? null
}

function findOpenClawAgentById(id: string): OpenClawAgentEntry | null {
  const config = readOpenClawConfig()
  const list = config?.agents?.list
  if (!Array.isArray(list)) return null
  return list.find((a) => a.id === id) ?? null
}

function readOpenClawConfig(): OpenClawConfig | null {
  try {
    return JSON.parse(readFileSync(getOpenClawPath('openclaw.json'), 'utf-8')) as OpenClawConfig
  } catch {
    return null
  }
}
