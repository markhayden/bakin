/**
 * Main agent resolution for Bakin.
 *
 * The orchestrator agent name is NOT hardcoded in source.
 * It's resolved at runtime from settings or OpenClaw config.
 */
import { readFileSync } from 'fs'

import { getSettings } from './settings'
import { getOpenClawPath } from './openclaw-home'

const OPENCLAW_JSON = getOpenClawPath('openclaw.json')

/**
 * Fallback mapping from OpenClaw canonical agent ids to Bakin display names.
 * Kept in sync with OPENCLAW_TO_BAKIN in packages/core/src/settings.ts — both
 * exist because settings.ts can't import from here without a cycle.
 */
const OPENCLAW_ID_TO_BAKIN_NAME: Record<string, string> = { main: 'roscoe' }

/**
 * Resolve the main/orchestrator agent ID.
 *
 * Resolution order:
 * 1. settings.json → mainAgentId
 * 2. OpenClaw config → agents.list → find id='main' → identity.name
 * 3. Hardcoded mapping (OpenClaw 'main' → Bakin 'roscoe')
 * 4. Fallback: 'main'
 */
export function getMainAgentId(): string {
  const settings = getSettings()
  const fromSettings = (settings as unknown as Record<string, unknown>).mainAgentId
  if (typeof fromSettings === 'string' && fromSettings) return fromSettings

  const fromOpenClaw = detectFromOpenClaw()
  if (fromOpenClaw) return fromOpenClaw

  return OPENCLAW_ID_TO_BAKIN_NAME.main ?? 'main'
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
