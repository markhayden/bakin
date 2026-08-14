'use client'

/**
 * Central agent store — replaces agents-data.ts, agent-settings.ts, and use-agent-settings.ts.
 *
 * Loads agent data from the team plugin API (which reads from the active runtime).
 * All components that need agent info import from here instead of static constants.
 */
import { create } from 'zustand'
import { pluginFetch } from '@makinbakin/sdk/utils'
import type { AgentMeta, AgentDisplaySettings, AgentDisplaySettingsMap, AgentWithStatus, OrgTeam, PackageStateRow } from '../types'

interface AgentStore {
  /** Lightweight agent list (for dropdowns, badges, avatars) */
  agents: AgentMeta[]
  /** Pre-computed ID list (stable reference for selectors) */
  agentIds: string[]
  /** Lookup map by ID */
  agentMap: Record<string, AgentMeta>
  /** Agents with runtime status (for team grid) */
  agentsWithStatus: AgentWithStatus[]
  /** Display settings (colors, display names, team assignments — Bakin-owned) */
  displaySettings: AgentDisplaySettingsMap
  /** Organizational teams */
  teams: OrgTeam[]
  /**
   * Agent-package state per agent id, sourced from `/api/agent-packages`.
   * Fetched in parallel with the roster on `load()`. Empty map when the
   * endpoint fails — agent-packages is optional context, not load-blocking.
   */
  packageStates: Record<string, PackageStateRow>
  /** Canonical main/orchestrator agent id (resolved server-side from the runtime adapter) */
  mainAgentId: string | null
  /** Whether initial load has completed */
  loaded: boolean

  /** Fetch agents + display settings + package states from the API */
  load: () => Promise<void>
  /** Re-fetch only `/api/agent-packages` — used after Adopt to invalidate staleness */
  refreshPackageStates: () => Promise<void>
  /** Update display settings for a single agent */
  updateDisplay: (agentId: string, patch: Partial<AgentDisplaySettings>) => Promise<void>
}

/**
 * Normalize a `/api/agent-packages` response into a Record keyed by agentId.
 * Handles both the success shape and any failure (non-ok response, network
 * error, malformed payload) by returning an empty map — the agent-package
 * surface is supplementary context, not load-blocking.
 */
async function parsePackageStatesResponse(
  res: Response | null,
): Promise<Record<string, PackageStateRow>> {
  if (!res || !res.ok) return {}
  try {
    const body = await res.json() as { ok?: boolean; agents?: PackageStateRow[] }
    if (!body.ok || !Array.isArray(body.agents)) return {}
    const map: Record<string, PackageStateRow> = {}
    for (const row of body.agents) {
      map[row.agentId] = row
    }
    return map
  } catch {
    return {}
  }
}

// ─── Roster snapshot cache ─────────────────────────────────────────────
// The roster fetch round-trips the runtime adapter server-side, so a fresh
// page shows letter-fallback avatars for seconds. Hydrating the lightweight
// meta (agents/displaySettings/mainAgentId) from the last-known snapshot
// renders avatars instantly; load() still refreshes from the server and
// remains the source of truth (`loaded` only flips on a real fetch).
const ROSTER_CACHE_KEY = 'bakin-agent-roster-v1'

interface RosterCache {
  agents: AgentMeta[]
  displaySettings: AgentDisplaySettingsMap
  mainAgentId: string | null
}

function readRosterCache(): RosterCache | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(ROSTER_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RosterCache
    if (!Array.isArray(parsed.agents)) return null
    // Shape-validate — a malformed cache must never poison the shell.
    const agents = parsed.agents.filter(
      (a): a is AgentMeta => !!a && typeof a === 'object' && typeof (a as AgentMeta).id === 'string' && typeof (a as AgentMeta).name === 'string',
    )
    return {
      agents,
      displaySettings: parsed.displaySettings && typeof parsed.displaySettings === 'object' ? parsed.displaySettings : {},
      mainAgentId: typeof parsed.mainAgentId === 'string' ? parsed.mainAgentId : null,
    }
  } catch {
    return null
  }
}

function writeRosterCache(cache: RosterCache): void {
  try {
    window.localStorage.setItem(ROSTER_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Cache is a nicety — storage failures never break the roster.
  }
}

const hydrated = readRosterCache()
const hydratedMap: Record<string, AgentMeta> = {}
for (const a of hydrated?.agents ?? []) hydratedMap[a.id] = a

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: hydrated?.agents ?? [],
  agentIds: (hydrated?.agents ?? []).map((a) => a.id),
  agentMap: hydratedMap,
  agentsWithStatus: [],
  displaySettings: hydrated?.displaySettings ?? {},
  teams: [],
  packageStates: {},
  mainAgentId: hydrated?.mainAgentId ?? null,
  loaded: false,

  load: async () => {
    try {
      const [rosterRes, pkgRes] = await Promise.all([
        pluginFetch('team', ''),
        fetch('/api/agent-packages?check=1').catch(() => null),
      ])
      if (!rosterRes.ok) {
        set({ loaded: true })
        return
      }
      const data = await rosterRes.json() as {
        agents: AgentWithStatus[]
        displaySettings: AgentDisplaySettingsMap
        teams: OrgTeam[]
        mainAgentId?: string
      }
      const agents: AgentMeta[] = data.agents.map(({
        status: _status,
        heartbeat: _heartbeat,
        heartbeatAge: _heartbeatAge,
        model: _model,
        ...meta
      }) => meta)
      const agentMap: Record<string, AgentMeta> = {}
      for (const a of agents) {
        agentMap[a.id] = a
      }
      const packageStates = await parsePackageStatesResponse(pkgRes)
      set({
        agents,
        agentIds: agents.map((a) => a.id),
        agentMap,
        agentsWithStatus: data.agents,
        displaySettings: data.displaySettings,
        teams: data.teams ?? [],
        packageStates,
        mainAgentId: data.mainAgentId ?? null,
        loaded: true,
      })
      writeRosterCache({
        agents,
        displaySettings: data.displaySettings,
        mainAgentId: data.mainAgentId ?? null,
      })
    } catch {
      set({ loaded: true })
    }
  },

  refreshPackageStates: async () => {
    const res = await fetch('/api/agent-packages?check=1').catch(() => null)
    const packageStates = await parsePackageStatesResponse(res)
    set({ packageStates })
  },

  updateDisplay: async (agentId, patch) => {
    const current = get().displaySettings
    const updated = {
      ...current,
      [agentId]: { ...current[agentId], ...patch },
    }
    set({ displaySettings: updated })

    await pluginFetch('team', 'settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    })
  },
}))

// ─── Selector Hooks ──────────────────────────────────────────────────────────

/** Get a single agent's meta by ID */
export function useAgent(agentId: string): AgentMeta | undefined {
  return useAgentStore((s) => s.agentMap[agentId])
}

/** Get the full agent list */
export function useAgentList(): AgentMeta[] {
  return useAgentStore((s) => s.agents)
}

/** Get an agent's accent color (hex). Falls back to zinc if unknown. */
export function useAgentColor(agentId: string): string {
  return useAgentStore(
    (s) => s.displaySettings[agentId]?.accentColor ?? '#a1a1aa'
  )
}

/** Get an agent's package state row. Undefined when the API hasn't reported one. */
export function usePackageState(agentId: string): PackageStateRow | undefined {
  return useAgentStore((s) => s.packageStates?.[agentId])
}

/** Get an agent's display name override, if any. */
export function useAgentDisplayName(agentId: string): string | undefined {
  return useAgentStore((s) => s.displaySettings[agentId]?.displayName)
}

/** Get all agent IDs (stable reference) */
export function useAgentIds(): string[] {
  return useAgentStore((s) => s.agentIds)
}

/** Get the canonical main/orchestrator agent id. Null until the store has loaded. */
export function useMainAgentId(): string | null {
  return useAgentStore((s) => s.mainAgentId)
}

/** Utility: convert hex to rgba with opacity */
export function hexToMuted(hex: string, opacity = 0.2): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}
