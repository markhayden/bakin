'use client'

/**
 * Central agent store — replaces agents-data.ts, agent-settings.ts, and use-agent-settings.ts.
 *
 * Loads agent data from the team plugin API (which reads from OpenClaw).
 * All components that need agent info import from here instead of static constants.
 */
import { create } from 'zustand'
import type { AgentMeta, AgentDisplaySettings, AgentDisplaySettingsMap, AgentWithStatus, OrgTeam } from '../types'

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
  /** Canonical main/orchestrator agent id (resolved server-side from settings → OpenClaw) */
  mainAgentId: string | null
  /** Whether initial load has completed */
  loaded: boolean

  /** Fetch agents + display settings from team plugin API */
  load: () => Promise<void>
  /** Update display settings for a single agent */
  updateDisplay: (agentId: string, patch: Partial<AgentDisplaySettings>) => Promise<void>
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [],
  agentIds: [],
  agentMap: {},
  agentsWithStatus: [],
  displaySettings: {},
  teams: [],
  mainAgentId: null,
  loaded: false,

  load: async () => {
    try {
      const res = await fetch('/api/plugins/team/')
      if (!res.ok) {
        set({ loaded: true })
        return
      }
      const data = await res.json() as {
        agents: AgentWithStatus[]
        displaySettings: AgentDisplaySettingsMap
        teams: OrgTeam[]
        mainAgentId?: string
      }
      const agents: AgentMeta[] = data.agents.map(({ status, heartbeat, heartbeatAge, model, ...meta }) => meta)
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
        mainAgentId: data.mainAgentId ?? null,
        loaded: true,
      })
    } catch {
      set({ loaded: true })
    }
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
