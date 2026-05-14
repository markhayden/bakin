/**
 * Health plugin — client entry point.
 */
import { registerPlugin } from '@makinbakin/sdk'
import type { NavItem } from '@makinbakin/sdk'
import { HealthPage } from './components/health-page'

const navItems: NavItem[] = [
  { id: 'health', label: 'Health', icon: 'Activity', href: '/health', order: 85 },
]

registerPlugin({
  id: 'health',
  navItems,
  slots: {
    'page:/health': HealthPage,
  },
})
