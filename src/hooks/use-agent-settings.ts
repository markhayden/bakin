'use client'

import { create } from 'zustand'
import { DEFAULT_AGENT_COLORS, mergeWithDefaults, type AgentSettingsMap } from '@/lib/agent-settings'

interface AgentSettingsState {
  settings: AgentSettingsMap
  loaded: boolean
  load: () => Promise<void>
  update: (agentId: string, patch: Partial<AgentSettingsMap[string]>) => Promise<void>
}

export const useAgentSettingsStore = create<AgentSettingsState>((set, get) => ({
  settings: mergeWithDefaults(),
  loaded: false,

  load: async () => {
    try {
      const res = await fetch('/api/agents/settings')
      if (res.ok) {
        const data = await res.json()
        set({ settings: mergeWithDefaults(data), loaded: true })
      } else {
        set({ loaded: true })
      }
    } catch {
      set({ loaded: true })
    }
  },

  update: async (agentId, patch) => {
    const current = get().settings
    const updated = {
      ...current,
      [agentId]: { ...current[agentId], ...patch },
    }
    set({ settings: updated })

    await fetch('/api/agents/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    })
  },
}))

/** Get an agent's accent color (hex). Falls back to default zinc if unknown. */
export function useAgentColor(agentId: string): string {
  return useAgentSettingsStore(
    (s) => s.settings[agentId]?.accentColor ?? DEFAULT_AGENT_COLORS[agentId] ?? '#a1a1aa'
  )
}

/** Get an agent's display name override, if any. */
export function useAgentDisplayName(agentId: string): string | undefined {
  return useAgentSettingsStore((s) => s.settings[agentId]?.displayName)
}
