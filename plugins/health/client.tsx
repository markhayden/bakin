/**
 * Health plugin — client entry point.
 */
import { registerPlugin } from '@makinbakin/sdk'
import type { NavItem } from '@makinbakin/sdk'
import { HealthPage } from './components/health-page'
import { HealthBadgeProvider } from './components/health-badge-provider'

const navItems: NavItem[] = [
  { id: 'health', label: 'Health', icon: 'Activity', href: '/health', order: 85 },
]

registerPlugin({
  id: 'health',
  navItems,
  slots: {
    'page:/health': HealthPage,
    // Background runner that keeps the Health nav badge (failing-check
    // count) in sync. Renders nothing; stays mounted while registered.
    'nav-badge-providers': HealthBadgeProvider,
  },
})
