/**
 * Assets plugin — client entry point.
 * Exports nav items for the plugin manifest.
 */
import type { NavItem } from '../../src/lib/plugin-types'

export const navItems: NavItem[] = [
  { id: 'assets', label: 'Assets', icon: 'FolderOpen', href: '/assets', order: 20 },
]
