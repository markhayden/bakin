/**
 * Health plugin — client entry point.
 */
import type { NavItem } from '../../src/lib/plugin-types'
import { registerSlot } from '@bakin/sdk/slots'
import { HealthPage } from './components/health-page'

export const navItems: NavItem[] = [
  { id: 'health', label: 'Health', icon: 'Activity', href: '/health', order: 85 },
]

registerSlot('page:/health', HealthPage)
