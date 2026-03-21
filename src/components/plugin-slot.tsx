'use client'

import { pluginRegistry } from '@/lib/plugin-registry'

interface PluginSlotProps {
  name: string
  props?: Record<string, unknown>
}

/**
 * Renders all components registered for a named slot, in order.
 */
export function PluginSlot({ name, props = {} }: PluginSlotProps) {
  let registrations: { component: React.ComponentType<Record<string, unknown>>; order?: number }[]
  try {
    registrations = pluginRegistry.getSlotComponents(name)
  } catch {
    // Registry not available on client — slots only work server-side for now
    return null
  }

  if (registrations.length === 0) return null

  return (
    <>
      {registrations.map((reg, i) => {
        const Component = reg.component
        return <Component key={`${name}-${i}`} {...props} />
      })}
    </>
  )
}
