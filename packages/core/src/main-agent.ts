/**
 * Main agent resolution for Bakin.
 *
 * The orchestrator agent id is NOT hardcoded in source. It is resolved at
 * runtime from settings or OpenClaw config. Display names are resolved
 * separately via `getMainAgentName()` from OpenClaw `identity.name`.
 */
import { readFileSync } from 'fs'

import { getSettings } from './settings'
import { getOpenClawPath } from './openclaw-home'

interface OpenClawAgentEntry {
  id: string
  identity?: { name?: string; emoji?: string }
}

/**
 * Resolve the main/orchestrator agent ID.
 *
 * Resolution order:
 * 1. settings.json → mainAgentId
 * 2. OpenClaw config → agents.list → entry with id='main' → its id
 * 3. Literal 'main'
 */
export function getMainAgentId(): string {
  const settings = getSettings()
  const fromSettings = settings.mainAgentId
  if (typeof fromSettings === 'string' && fromSettings) return fromSettings

  const entry = findOpenClawMainAgent('main')
  if (entry) return entry.id

  return 'main'
}

/**
 * Resolve the main agent's display name, used in rendered UI and agent-rules
 * text substitution. Reads `identity.name` from `~/.openclaw/openclaw.json`.
 * Falls back to a title-cased version of the canonical id when unset.
 */
export function getMainAgentName(): string {
  const id = getMainAgentId()
  const entry = findOpenClawMainAgent(id)
  const name = entry?.identity?.name
  if (typeof name === 'string' && name.trim().length > 0) return name
  return id.charAt(0).toUpperCase() + id.slice(1)
}

function findOpenClawMainAgent(preferredId: string): OpenClawAgentEntry | null {
  try {
    const config = JSON.parse(readFileSync(getOpenClawPath('openclaw.json'), 'utf-8'))
    const list = config?.agents?.list as OpenClawAgentEntry[] | undefined
    if (!Array.isArray(list)) return null
    return list.find((a) => a.id === preferredId) ?? null
  } catch {
    return null
  }
}
