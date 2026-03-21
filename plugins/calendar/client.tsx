/**
 * Content Calendar plugin — client entry point.
 * Nav items registered here.
 */
import type { NavItem } from '../../src/lib/plugin-types'

// Calendar nav item already exists in tasks/client.tsx at order 20
// We'll use the same route but replace the page content
export const navItems: NavItem[] = [
  { id: 'calendar', label: 'Content Calendar', icon: 'Calendar', href: '/calendar', order: 25 },
]
