/**
 * Brands plugin — client entry point.
 * Nav is declared in bakin-plugin.json `contributes.nav`; slots are mirrored
 * in `contributes.slots`.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { BrandsPage } from './components/brands-page'
import { TaskBrandPanel } from './components/task-brand-panel'

registerPlugin({
  id: 'brands',
  slots: {
    'page:/brands': BrandsPage,
    // Rendered inside the task detail (tasks plugin) — effective brand,
    // provenance, injection records, debug card viewer (spec §5.5).
    'task-brand': TaskBrandPanel,
  },
})
