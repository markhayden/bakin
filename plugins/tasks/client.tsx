/**
 * Tasks plugin — client entry point.
 * Exports nav items and re-exports components for the plugin manifest.
 */
import type { NavItem } from '../../src/lib/plugin-types'

export const navItems: NavItem[] = [
  { id: 'tasks', label: 'Tasks', icon: 'CheckSquare', href: '/tasks', order: 10 },

  { id: 'projects', label: 'Projects', icon: 'Layers', href: '/projects', order: 30 },
  { id: 'team', label: 'Team', icon: 'Users', href: '/team', order: 60 },
]
