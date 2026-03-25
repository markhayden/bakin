/**
 * Schedule plugin — client entry point.
 * Nav items registered here.
 */
import type { NavItem } from '../../src/lib/plugin-types'

export const navItems: NavItem[] = [
  { id: 'schedule', label: 'Schedule', icon: 'AlarmClock', href: '/schedule', order: 22 },
]
