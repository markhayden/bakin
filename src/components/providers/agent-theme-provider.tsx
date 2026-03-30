'use client'

import { useEffect } from 'react'
import { useAgentSettingsStore } from '@/hooks/use-agent-settings'
import { hexToMuted } from '@/lib/agent-settings'

/**
 * Fetches agent settings on mount and injects per-agent CSS custom properties
 * onto :root. Components can reference e.g. var(--agent-roscoe) for the accent color.
 */
export function AgentThemeProvider({ children }: { children: React.ReactNode }) {
  const settings = useAgentSettingsStore((s) => s.settings)
  const loaded = useAgentSettingsStore((s) => s.loaded)
  const load = useAgentSettingsStore((s) => s.load)

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!loaded) return
    const root = document.documentElement
    for (const [id, agent] of Object.entries(settings)) {
      root.style.setProperty(`--agent-${id}`, agent.accentColor)
      root.style.setProperty(`--agent-${id}-muted`, hexToMuted(agent.accentColor))
    }
  }, [settings, loaded])

  return <>{children}</>
}
