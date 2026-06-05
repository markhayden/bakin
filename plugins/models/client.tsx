/**
 * Models plugin — client entry point.
 * Nav is declared in bakin-plugin.json `contributes.nav`; slots are mirrored
 * in `contributes.slots` so the host lazy-loads this client on first render.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { ModelsPage } from './components/models-page'

registerPlugin({
  id: 'models',
  slots: {
    'page:/models': ModelsPage,
  },
})
