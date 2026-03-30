/**
 * Main agent resolution for Bakin.
 *
 * The orchestrator agent name is NOT hardcoded in source.
 * It's resolved at runtime from settings or OpenClaw config.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

import { getSettings } from './settings'

const OPENCLAW_JSON = join(homedir(), '.openclaw', 'openclaw.json')

/**
 * Resolve the main/orchestrator agent ID.
 *
 * Resolution order:
 * 1. settings.json → mainAgentId
 * 2. OpenClaw config → agents.list → find id='main' → identity.name
 * 3. Fallback: 'main'
 */
export function getMainAgentId(): string {
  const settings = getSettings()
  const fromSettings = (settings as unknown as Record<string, unknown>).mainAgentId
  if (typeof fromSettings === 'string' && fromSettings) return fromSettings

  const fromOpenClaw = detectFromOpenClaw()
  if (fromOpenClaw) return fromOpenClaw

  return 'main'
}

function detectFromOpenClaw(): string | null {
  try {
    const config = JSON.parse(readFileSync(OPENCLAW_JSON, 'utf-8'))
    const mainAgent = (config.agents?.list as Array<{ id: string; identity?: { name?: string } }>)
      ?.find((a: { id: string }) => a.id === 'main')
    if (mainAgent?.identity?.name) return mainAgent.identity.name.toLowerCase()
    return null
  } catch {
    return null
  }
}
