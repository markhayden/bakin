/**
 * Bakin-owned team plugin settings: display settings (per-agent accent colors,
 * team membership) and the OrgTeam list, persisted in the team plugin's
 * settings store.
 *
 * Extracted from index.ts. Pure store-backed I/O plus the `reportsTo`
 * normalization/degradation helpers and the runtime-merged display defaults —
 * no plugin-context coupling, so the REST routes, status resolution, and
 * activate() all import from here.
 */
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import {
  readPluginSettings as readStoredPluginSettings,
  writePluginSettings as writeStoredPluginSettings,
} from '@bakin/core/plugins/settings-store'

import { createLogger } from '../../../src/core/logger'
import type { AgentDisplaySettingsMap, OrgTeam, TeamPluginSettings } from '../types'

const log = createLogger('team')

const DEFAULT_COLORS: Record<string, string> = {
  main: '#60a5fa',
  chef: '#4ade80',
  pixel: '#a78bfa',
  rolo: '#fb923c',
  patch: '#a1a1aa',
  explorer: '#34d399',
  trainer: '#22d3ee',
  coach: '#fbbf24',
}

export function readPluginSettings(): TeamPluginSettings {
  const raw = readStoredPluginSettings<Record<string, unknown>>('team')
  // Migrate: old format was just AgentDisplaySettingsMap at root.
  if (raw && Object.keys(raw).length > 0 && !raw.displaySettings && !raw.teams) {
    return { displaySettings: raw as AgentDisplaySettingsMap, teams: [] }
  }
  return {
    displaySettings: (raw.displaySettings as AgentDisplaySettingsMap) ?? {},
    teams: (raw.teams as TeamPluginSettings['teams']) ?? [],
  }
}

export function writePluginSettings(settings: TeamPluginSettings): void {
  writeStoredPluginSettings('team', settings)
}

export function readDisplaySettings(): AgentDisplaySettingsMap {
  return readPluginSettings().displaySettings
}

export function writeDisplaySettings(settings: AgentDisplaySettingsMap): void {
  const current = readPluginSettings()
  writePluginSettings({ ...current, displaySettings: settings })
}

export function readTeams(): OrgTeam[] {
  return readPluginSettings().teams
}

export function writeTeams(teams: OrgTeam[]): void {
  const current = readPluginSettings()
  writePluginSettings({ ...current, teams })
}

/**
 * Normalize a `reportsTo` value for persistence in team.json.
 *
 * Stores `null` when the incoming value is undefined/null or equals the
 * current main agent id. This decouples team.json from the specific
 * orchestrator name so installs sharing the file don't get pinned to
 * "main" (or whatever id the local main agent happens to use).
 */
export function normalizeReportsTo(value: unknown, mainAgentId: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return null
  if (value === mainAgentId) return null
  return value
}

/**
 * Degrade teams whose `reportsTo` points at an agent that no longer
 * exists in the roster. The render-time resolver treats `null` as
 * "report to main", so this keeps legacy team.json files rendering
 * cleanly after a rename or removal. Read-only — never rewrites the
 * file from the read path.
 */
export function degradeUnknownReportsTo(teams: OrgTeam[], knownIds: Set<string>): OrgTeam[] {
  return teams.map((team) => {
    const reportsTo = team.reportsTo
    if (typeof reportsTo === 'string' && !knownIds.has(reportsTo)) {
      log.warn('team.json has a team reporting to unknown agent id — treating as null', {
        teamId: team.id,
        reportsTo,
      })
      return { ...team, reportsTo: null }
    }
    return team
  })
}

export async function mergeDisplayDefaults(
  runtime: AgentRuntimeAdapter,
  overrides: AgentDisplaySettingsMap,
): Promise<AgentDisplaySettingsMap> {
  const result: AgentDisplaySettingsMap = {}
  const ids = (await runtime.agents.list()).map((agent) => agent.id)
  for (const id of ids) {
    result[id] = {
      ...overrides[id],
      accentColor: overrides[id]?.accentColor ?? DEFAULT_COLORS[id] ?? '#a1a1aa',
    }
  }
  return result
}
