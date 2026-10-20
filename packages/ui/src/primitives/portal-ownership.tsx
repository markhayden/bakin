'use client'

import { createContext, use, type ReactNode } from 'react'

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
    <PluginPortalOwnershipContext value={pluginId}>
      {children}
    </PluginPortalOwnershipContext>
  )
}

/** Transparent DOM ownership boundary for content rendered outside its page root. */
export function PluginPortalBoundary({ children }: { children: ReactNode }) {
  const pluginId = use(PluginPortalOwnershipContext)
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
