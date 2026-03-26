/**
 * Health plugin — client entry point.
 */
import type { NavItem } from '../../src/lib/plugin-types'

export const navItems: NavItem[] = [
  { id: 'health', label: 'Health', icon: 'Activity', href: '/health', order: 85 },
]
