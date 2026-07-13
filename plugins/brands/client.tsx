/**
 * Brands plugin — client entry point.
 * Nav is declared in bakin-plugin.json `contributes.nav`; slots are mirrored
 * in `contributes.slots`.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { BrandsPage } from './components/brands-page'
import { BrandDetailPage } from './components/brand-detail-page'
import { BrandDocEditorPage } from './components/brand-doc-editor'
import { TaskBrandPanel } from './components/task-brand-panel'

registerPlugin({
  id: 'brands',
  search: {
    hitRenderers: {
      brands: (hit) => ({
        title: String(hit.fields.title ?? hit.id),
        subtitle: String(hit.fields.description ?? '').trim() || `brand doc: ${hit.fields.doc ?? ''}`,
        href: `/brands/${encodeURIComponent(String(hit.fields.brand_id ?? ''))}`,
        icon: 'paintbrush',
      }),
      'brand-lessons': (hit) => ({
        title: String(hit.fields.title ?? hit.id),
        subtitle: `brand lesson · ${hit.fields.brand_id ?? ''}`,
        href: `/brands/${encodeURIComponent(String(hit.fields.brand_id ?? ''))}`,
        icon: 'paintbrush',
      }),
    },
  },
  slots: {
    'page:/brands': BrandsPage,
    // Rendered via <Slot name="page:/brands/:brandId" /> in routes/brands.$brandId.tsx.
    'page:/brands/:brandId': BrandDetailPage,
    // Full-width doc editor route (routes/brands.$brandId.docs.$kind.$name.tsx).
    'page:/brands/:brandId/docs': BrandDocEditorPage,
    // Rendered inside the task detail (tasks plugin) — effective brand,
    // provenance, injection records, debug card viewer (spec §5.5).
    'task-brand': TaskBrandPanel,
  },
})
