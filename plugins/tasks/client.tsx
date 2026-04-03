/**
 * Tasks plugin — client entry point.
 * Exports nav items and re-exports components for the plugin manifest.
 */
import type { NavItem } from '../../src/lib/plugin-types'

export const navItems: NavItem[] = [
  { id: 'tasks', label: 'Tasks', icon: 'CheckSquare', href: '/tasks', order: 10 },
]
