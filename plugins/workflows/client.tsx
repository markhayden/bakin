/**
 * Workflows plugin — client entry point
 */
import type { NavItem } from '../../src/lib/plugin-types'

export const navItems: NavItem[] = [
  { id: 'workflows', label: 'Workflows', icon: 'Workflow', href: '/workflows', order: 40 },
]
