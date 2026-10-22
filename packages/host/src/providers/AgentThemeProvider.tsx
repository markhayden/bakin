import { useEffect } from 'react'
import { useAgentStore, hexToMuted, usePluginEvent } from '@makinbakin/sdk/hooks'

/**
 * Fetches agent data on mount and injects per-agent CSS custom properties
 * onto :root. Components can reference e.g. var(--agent-main) for the accent color.
 *
 * It also owns the roster's `updates.changed` subscription (#1007 B): when
 * the updates engine changes a `package:` record, the agent-package rows are
 * re-read here — once, for every Team surface (grid badge, detail card) —
 * so a scheduled pass lands without a reload wherever the roster is shown.
 */
export function AgentThemeProvider({ children }: { children: React.ReactNode }) {
  const displaySettings = useAgentStore((s) => s.displaySettings)
  const loaded = useAgentStore((s) => s.loaded)
  const load = useAgentStore((s) => s.load)
  const refreshPackageStates = useAgentStore((s) => s.refreshPackageStates)

  useEffect(() => {
    load()
  }, [load])

  usePluginEvent('updates.changed', (payload) => {
    const ids = (payload as { ids?: unknown }).ids
    if (!Array.isArray(ids) || !ids.some((id) => typeof id === 'string' && id.startsWith('package:'))) return
    void refreshPackageStates()
  })

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
