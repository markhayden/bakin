/**
 * Brands plugin — client entry point.
 * Nav is declared in bakin-plugin.json `contributes.nav`; slots are mirrored
 * in `contributes.slots`.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { BrandsPage } from './components/brands-page'

registerPlugin({
  id: 'brands',
  slots: {
    'page:/brands': BrandsPage,
  },
})
