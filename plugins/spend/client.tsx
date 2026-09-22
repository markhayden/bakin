/**
 * Spend plugin — client entry point. Nav lives in the manifest; this
 * registers the page slot only.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { SpendPage } from './components/spend-page'

registerPlugin({
  id: 'spend',
  slots: {
    'page:/spend': SpendPage,
  },
})
