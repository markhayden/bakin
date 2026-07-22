'use client'

/**
 * Host-injected plugin ownership boundary.
 *
 * The DOM attribute is the stable CSS-containment root. The matching React
 * context lets SDK-managed portals retain the same identity when their DOM
 * leaves this subtree. This is host plumbing, not a plugin-author component:
 * callers derive the id from the registration registry rather than trusting
 * contribution markup to identify itself.
 */
import { createContext, useContext, type JSX, type ReactNode } from 'react'
import { PluginPortalOwnershipProvider } from '@bakin/ui'

const PluginOwnershipContext = createContext<string | null>(null)

interface PluginOwnershipRootProps {
  pluginId: string
  children: ReactNode
}

export function PluginOwnershipRoot({ pluginId, children }: PluginOwnershipRootProps): JSX.Element {
  return (
    <PluginOwnershipContext.Provider value={pluginId}>
      <PluginPortalOwnershipProvider pluginId={pluginId}>
        <div className="contents" data-bakin-plugin={pluginId}>
          {children}
        </div>
      </PluginPortalOwnershipProvider>
    </PluginOwnershipContext.Provider>
  )
}

/** Current host-injected plugin id, used by ownership-aware SDK internals. */
export function usePluginOwnership(): string | null {
  return useContext(PluginOwnershipContext)
}
