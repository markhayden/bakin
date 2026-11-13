/**
 * Home plugin — client entry point.
 * Contributes the Home page slot. Nav is declared in bakin-plugin.json
 * `contributes.nav`; the shell renders the slot at `/` and puts Home first
 * in the sidebar.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { HomePage } from './components/home-page'

registerPlugin({
  id: 'home',
  slots: {
    'page:/home': HomePage,
  },
})
