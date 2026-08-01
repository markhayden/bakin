'use client'

import { createContext, useContext, type ReactNode } from 'react'

const PluginPortalOwnershipContext = createContext<string | null>(null)

export interface PluginPortalOwnershipProviderProps {
  pluginId: string
  children: ReactNode
}

/** Host-only bridge that carries an authenticated plugin id into UI portals. */
export function PluginPortalOwnershipProvider({
  pluginId,
  children,
}: PluginPortalOwnershipProviderProps) {
  return (
    <PluginPortalOwnershipContext.Provider value={pluginId}>
      {children}
    </PluginPortalOwnershipContext.Provider>
  )
}

/** Transparent DOM ownership boundary for content rendered outside its page root. */
export function PluginPortalBoundary({ children }: { children: ReactNode }) {
  const pluginId = useContext(PluginPortalOwnershipContext)
  if (!pluginId) return children

  return (
    <div
      className="contents"
      data-bakin-plugin={pluginId}
      data-bakin-plugin-portal={pluginId}
    >
      {children}
    </div>
  )
}
