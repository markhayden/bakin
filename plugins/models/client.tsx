/**
 * Models plugin — client entry point.
 * Exports nav items for the models section.
 */
import type { NavItem } from '@/lib/plugin-types'

export const navItems: NavItem[] = [
  { id: 'models', label: 'Models', icon: 'Cpu', href: '/models', order: 70 },
]
