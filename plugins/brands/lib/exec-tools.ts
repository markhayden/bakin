/**
 * Brand exec tools (#419, spec §7.2) — the pull-based tier of the two-tier
 * card model. The dispatch card lists what exists; agents fetch what the
 * task needs through these. Read-only in T2.1 (add_lesson lands in T3.2;
 * draft-gated write tools in T6.2 — agents never mutate published brand
 * identity).
 */
import { z } from 'zod'
import type { PluginContext } from '@bakin/core/plugin-types'
import { getBrand, listBrands, listDocs, readDoc } from './store'
import { computeBrandFingerprint } from './fingerprint'

export function registerBrandExecTools(ctx: PluginContext): void {
  ctx.registerExecTool({
    name: 'bakin_exec_brands_list',
    label: 'Listed brands',
    description: 'List all published brands (id, name, description). Drafts are excluded.',
    parameters: {},
    handler: async () => {
      const { brands } = listBrands()
      return {
        ok: true,
        brands: brands
          .filter((b) => !b.draft)
          .map((b) => ({ id: b.id, name: b.name, description: b.description })),
      }
    },
  })

  ctx.registerExecTool({
    name: 'bakin_exec_brands_get',
    label: 'Read a brand',
    description:
      'Full brand view: palette, absolute rules, terminology, logos, asset groups, guideline/lesson doc listings (with descriptions), and the content fingerprint. Use read_doc to fetch a doc body.',
    parameters: {
      brandId: z.string().describe('Brand id (see bakin_exec_brands_list)'),
    },
    handler: async (params) => {
      const brandId = String(params.brandId ?? '')
      const read = getBrand(brandId)
      if (read.status !== 'ok') {
        return { ok: false, error: `brand not found: ${brandId}` }
      }
      return {
        ok: true,
        brand: read.manifest,
        guidelines: listDocs(brandId, 'guidelines'),
        lessons: listDocs(brandId, 'lessons'),
        fingerprint: computeBrandFingerprint(brandId),
      }
    },
  })

  ctx.registerExecTool({
    name: 'bakin_exec_brands_read_doc',
    label: 'Read a brand doc',
    description: 'Read one guideline or lesson markdown body for a brand.',
    parameters: {
      brandId: z.string().describe('Brand id'),
      kind: z.enum(['guidelines', 'lessons']).describe('Doc kind'),
      name: z.string().describe('Doc filename, e.g. style-guide.md'),
    },
    handler: async (params) => {
      const brandId = String(params.brandId ?? '')
      const kind = params.kind === 'lessons' ? 'lessons' as const : 'guidelines' as const
      const name = String(params.name ?? '')
      try {
        const content = readDoc(brandId, kind, name)
        if (content === null) return { ok: false, error: `doc not found: ${kind}/${name}` }
        return { ok: true, name, content }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })
}
