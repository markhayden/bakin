/**
 * Spend plugin — client entry point. Nav lives in the manifest; this
 * registers the page slot only.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { SpendBadgeProvider } from './components/spend-badge-provider'
import { SpendPage } from './components/spend-page'

registerPlugin({
  id: 'spend',
  slots: {
    'page:/spend': SpendPage,
    // Background runner for the notification ladder: Spend nav badge +
    // 50/75 toast/OS notifications. Renders nothing; eager so it is live on
    // every page.
    'nav-badge-providers': SpendBadgeProvider,
  },
})
