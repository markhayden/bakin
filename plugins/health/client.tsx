/**
 * Health plugin — client entry point.
 * Nav is declared in bakin-plugin.json `contributes.nav`; slots are mirrored
 * in `contributes.slots`. Eager (`contributes.eager`) because the nav badge
 * provider must run at boot.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { HealthPage } from './components/health-page'
import { HealthBadgeProvider } from './components/health-badge-provider'

registerPlugin({
  id: 'health',
  slots: {
    'page:/health': HealthPage,
    // Background runner that keeps the Health nav badge (failing-check
    // count) in sync. Renders nothing; stays mounted while registered.
    'nav-badge-providers': HealthBadgeProvider,
  },
})
