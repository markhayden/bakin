/**
 * Projects plugin — client entry point.
 * Nav items registered here.
 */
import type { NavItem } from '../../src/lib/plugin-types'

export const navItems: NavItem[] = [
  { id: 'projects', label: 'Projects', icon: 'Compass', href: '/projects', order: 30 },
]
