/**
 * Workflows plugin — client entry point
 *
 * Exports:
 * - `navItems`: sidebar entries (merged into the shell by plugin-manifest)
 * - `nodeRenderers`: React components xyflow uses to render each node
 *   kind on the canvas. Keys must match the kind registered server-side:
 *   bare (`agent`, `gate`, etc.) for builtins, namespaced
 *   (`{pluginId}.{kind}`) for plugins. Populated in T6.
 */
import type { NodeTypes } from '@xyflow/react'
import type { NavItem } from '../../src/lib/plugin-types'

export const navItems: NavItem[] = [
  { id: 'workflows', label: 'Workflows', icon: 'Workflow', href: '/workflows', order: 40 },
]

export const nodeRenderers: NodeTypes = {}
