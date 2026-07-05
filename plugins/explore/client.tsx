/**
 * Explore plugin — client entry point.
 * Nav is declared in bakin-plugin.json `contributes.nav` (placement: bottom,
 * pinned above Settings); slots are mirrored in `contributes.slots`.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { ExplorePage } from './components/explore-page'

registerPlugin({
  id: 'explore',
  slots: {
    'page:/explore': ExplorePage,
  },
})
