/**
 * Team plugin — client entry point.
 * Nav items registered here.
 */
import type { NavItem } from '../../src/lib/plugin-types'

export const navItems: NavItem[] = [
  { id: 'team', label: 'Team', icon: 'Users', href: '/team', order: 60 },
]
