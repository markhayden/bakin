/**
 * Home plugin — client entry point.
 * Contributes the Home page slot; the shell owns where it sits in the
 * sidebar and which path opens it.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { HomePage } from './components/home-page'

registerPlugin({
  id: 'home',
  slots: {
    'page:/home': HomePage,
  },
})
