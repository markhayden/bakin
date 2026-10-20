'use client'

/**
 * Central agent store — replaces agents-data.ts, agent-settings.ts, and use-agent-settings.ts.
 *
 * Loads agent data from the team plugin API (which reads from the active runtime).
 * All components that need agent info import from here instead of static constants.
 */
import { create } from 'zustand'
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
   * Agent-package state per agent id, sourced from `/api/agent-packages`
   * (lockfile state + the updates engine's record for the package — the
   * route never probes a source, so the roster never waits on the network).
   * Fetched in parallel with the roster on `load()`. A failed read keeps the
   * last known rows — agent-packages is optional context, not load-blocking.
   */
  packageStates: Record<string, PackageStateRow>
  /** ISO instant of the last SUCCESSFUL package-rows read; null before one. */
  packageStatesAt: string | null
  /**
   * The last package-rows read failed (the rows above are LAST KNOWN, not
   * current — review r6 #3); null once a read succeeds again.
   */
  packageStatesError: string | null
  /** Canonical main/orchestrator agent id (resolved server-side from the runtime adapter) */
  mainAgentId: string | null
  /** Whether initial load has completed */
  loaded: boolean

  /** Fetch agents + display settings + package states from the API */
  /** Reload the roster; resolves false when it could not be refreshed (the previous roster stays). */
  load: () => Promise<boolean>
  /** Re-fetch only `/api/agent-packages` — after Adopt/Sync/Orphan, and on `updates.changed` for a package. */
  refreshPackageStates: () => Promise<void>
  /** Update display settings for a single agent */
  updateDisplay: (agentId: string, patch: Partial<AgentDisplaySettings>) => Promise<void>
}

/**
 * Normalize a `/api/agent-packages` response into a Record keyed by agentId,
 * or null for a FAILED read (non-ok response, network error, malformed
 * payload) — a failure keeps the last known rows, it never turns managed
 * agents into "unmanaged" ones (review r5 #2). The agent-package surface is
 * supplementary context, not load-blocking.
 */
type PackageStatesRead = { states: Record<string, PackageStateRow>; error?: undefined } | { states?: undefined; error: string }

async function parsePackageStatesResponse(res: Response | null): Promise<PackageStatesRead> {
  if (!res) return { error: 'Package state could not be reached.' }
  if (!res.ok) return { error: `Package state read failed${typeof res.status === 'number' ? ` (HTTP ${res.status})` : ''}.` }
  try {
    const body = await res.json() as { ok?: boolean; agents?: PackageStateRow[]; error?: string }
    if (!body.ok || !Array.isArray(body.agents)) return { error: typeof body.error === 'string' && body.error ? body.error : 'Package state returned an invalid response.' }
    const map: Record<string, PackageStateRow> = {}
    for (const row of body.agents) {
      map[row.agentId] = row
    }
    return { states: map }
  } catch {
    return { error: 'Package state returned an invalid response.' }
  }
}

/** What a package-rows read sets: the rows + a fresh instant on success, or the error over the LAST KNOWN rows on failure. */
function packageStatesPatch(read: PackageStatesRead): Partial<Pick<AgentStore, 'packageStates' | 'packageStatesAt' | 'packageStatesError'>> {
  return read.states
    ? { packageStates: read.states, packageStatesAt: new Date().toISOString(), packageStatesError: null }
    : { packageStatesError: read.error }
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

/**
 * Every package-rows read (the initial load, a post-write refresh, an
 * `updates.changed` re-read) takes a generation; a response that is no
 * longer the newest request's is dropped, so overlapping reads can never put
 * an obsolete update badge back (PR 8 review r3 #6).
 */
let packageStatesGeneration = 0

const hydrated = readRosterCache()
const hydratedMap: Record<string, AgentMeta> = {}
for (const a of hydrated?.agents ?? []) hydratedMap[a.id] = a

// NOTE: raw fetch on purpose. The SDK re-exports this hook through
// @makinbakin/sdk/hooks, so importing an SDK barrel here (pluginFetch lives in
// @makinbakin/sdk/utils) closes an import cycle the ratchet rejects.
export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: hydrated?.agents ?? [],
  agentIds: (hydrated?.agents ?? []).map((a) => a.id),
  agentMap: hydratedMap,
  agentsWithStatus: [],
  displaySettings: hydrated?.displaySettings ?? {},
  teams: [],
  packageStates: {},
  packageStatesAt: null,
  packageStatesError: null,
  mainAgentId: hydrated?.mainAgentId ?? null,
  loaded: false,

  load: async () => {
    const generation = ++packageStatesGeneration
    const [rosterRes, pkgRes] = await Promise.all([
      fetch('/api/plugins/team/').catch(() => null),
      fetch('/api/agent-packages').catch(() => null),
    ])
    // The package answer stands on its own: a failed roster never discards
    // it (and never lets an OLDER read's answer land after it, review r4 #5).
    const packageRead = await parsePackageStatesResponse(pkgRes)
    const publishPackages = (): void => { if (generation === packageStatesGeneration) set(packageStatesPatch(packageRead)) }
    try {
      if (!rosterRes || !rosterRes.ok) {
        publishPackages()
        set({ loaded: true })
        return false
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
      set({
        agents,
        agentIds: agents.map((a) => a.id),
        agentMap,
        agentsWithStatus: data.agents,
        displaySettings: data.displaySettings,
        teams: data.teams ?? [],
        // A newer package read is in flight or landed: its answer wins; a failed read keeps the last known rows (and says so).
        ...(generation === packageStatesGeneration ? packageStatesPatch(packageRead) : {}),
        mainAgentId: data.mainAgentId ?? null,
        loaded: true,
      })
      writeRosterCache({
        agents,
        displaySettings: data.displaySettings,
        mainAgentId: data.mainAgentId ?? null,
      })
      return true
    } catch {
      publishPackages()
      set({ loaded: true })
      return false
    }
  },

  refreshPackageStates: async () => {
    const generation = ++packageStatesGeneration
    const res = await fetch('/api/agent-packages').catch(() => null)
    const read = await parsePackageStatesResponse(res)
    if (generation !== packageStatesGeneration) return
    set(packageStatesPatch(read))
  },

  updateDisplay: async (agentId, patch) => {
    const current = get().displaySettings
    const updated = {
      ...current,
      [agentId]: { ...current[agentId], ...patch },
    }
    set({ displaySettings: updated })

    await fetch('/api/plugins/team/settings', {
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
