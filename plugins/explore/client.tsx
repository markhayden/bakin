/**
 * Explore plugin — client entry point.
 * Discovery navigation is owned by the shell's responsive Make Bakin Yours
 * entry; this plugin contributes only the Explore page slot.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { ExplorePage } from './components/explore-page'

registerPlugin({
  id: 'explore',
  slots: {
    'page:/explore': ExplorePage,
  },
})
