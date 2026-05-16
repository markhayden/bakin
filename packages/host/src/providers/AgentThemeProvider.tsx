import { useEffect } from 'react'
import { useAgentStore, hexToMuted } from '@makinbakin/sdk/hooks'

/**
 * Fetches agent data on mount and injects per-agent CSS custom properties
 * onto :root. Components can reference e.g. var(--agent-main) for the accent color.
 */
export function AgentThemeProvider({ children }: { children: React.ReactNode }) {
  const displaySettings = useAgentStore((s) => s.displaySettings)
  const loaded = useAgentStore((s) => s.loaded)
  const load = useAgentStore((s) => s.load)

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!loaded) return
    const root = document.documentElement
    for (const [id, agent] of Object.entries(displaySettings)) {
      const color = agent.accentColor ?? '#a1a1aa'
      root.style.setProperty(`--agent-${id}`, color)
      root.style.setProperty(`--agent-${id}-muted`, hexToMuted(color))
    }
  }, [displaySettings, loaded])

  return <>{children}</>
}
