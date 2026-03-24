/**
 * Memory plugin — client entry point.
 * Exports nav items for the memory section.
 */
import type { NavItem } from '../../src/lib/plugin-types'

export const navItems: NavItem[] = [
  { id: 'memory', label: 'Memory', icon: 'Brain', href: '/memory', order: 50 },
]
