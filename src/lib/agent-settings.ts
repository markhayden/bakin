/**
 * Agent display settings — colors, display names, headshot overrides.
 * Consolidates AGENT_AVATAR_COLORS, AGENT_COLORS, AGENT_DOT into one system.
 * Settings are stored in ~/.bakin/plugin-settings/agents.json and override defaults.
 */

export interface AgentDisplaySettings {
  displayName?: string
  accentColor: string       // hex color, e.g. '#60a5fa'
}

export type AgentSettingsMap = Record<string, AgentDisplaySettings>

/** Default accent colors per agent (hex) — replaces all hardcoded Tailwind color maps */
export const DEFAULT_AGENT_COLORS: Record<string, string> = {
  main-operator: '#60a5fa',  // blue-400
  chef:  '#4ade80',  // green-400
  pixel:  '#a78bfa',  // violet-400
  rolo:   '#fb923c',  // orange-400
  patch:  '#a1a1aa',  // zinc-400
  explorer:  '#34d399',  // emerald-400
  trainer:   '#22d3ee',  // cyan-400
  coach:    '#fbbf24',  // amber-400
}

/** Build full settings map with defaults for any missing agents */
export function mergeWithDefaults(overrides: Partial<AgentSettingsMap> = {}): AgentSettingsMap {
  const result: AgentSettingsMap = {}
  for (const [id, color] of Object.entries(DEFAULT_AGENT_COLORS)) {
    result[id] = {
      accentColor: color,
      ...overrides[id],
    }
  }
  // Include any agents in overrides not in defaults
  for (const [id, settings] of Object.entries(overrides)) {
    if (!result[id] && settings) {
      result[id] = { ...settings, accentColor: settings.accentColor ?? '#a1a1aa' }
    }
  }
  return result
}

/**
 * Given a hex color like '#60a5fa', return a muted version at 20% opacity
 * as an rgba string for backgrounds.
 */
export function hexToMuted(hex: string, opacity = 0.2): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}
