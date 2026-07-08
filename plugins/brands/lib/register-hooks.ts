/**
 * Cross-plugin hooks (#419, spec §7.1).
 *
 * The ONLY way other plugins and core reach brand data — no direct imports
 * (architecture-test enforced). `brands.get` returns draft brands with the
 * flag visible (consumers like images decide how to treat drafts);
 * `brands.list` excludes drafts entirely so pickers can never offer one.
 */
import type { PluginContext } from '@bakin/core/plugin-types'
import { getBrand, listBrands, listDocs } from './store'
import { computeBrandFingerprint } from './fingerprint'
import { buildBrandCard, type BrandCardInput } from './card'

export function registerBrandsHooks(ctx: PluginContext): void {
  ctx.hooks.register(
    'brands.get',
    (data: { brandId?: string }) => {
      if (!data?.brandId) return undefined
      const read = getBrand(data.brandId)
      if (read.status !== 'ok') return undefined
      return {
        manifest: read.manifest,
        guidelines: listDocs(read.manifest.id, 'guidelines'),
        lessons: listDocs(read.manifest.id, 'lessons'),
        fingerprint: computeBrandFingerprint(read.manifest.id),
      }
    },
    { label: 'Get brand', summary: 'Brand manifest + doc listings + fingerprint (drafts included, flagged)' },
  )

  ctx.hooks.register(
    'brands.getContext',
    async (data: { brandId?: string; maxBytes?: number; lessons?: BrandCardInput['lessons']; lessonsUnavailable?: boolean }) => {
      if (!data?.brandId) return { notFound: true }
      return buildBrandCard(data.brandId, {
        maxBytes: typeof data.maxBytes === 'number' && data.maxBytes > 0 ? data.maxBytes : 12288,
        lessons: data.lessons,
        lessonsUnavailable: data.lessonsUnavailable,
        assetExists: async (assetId) => (await ctx.assets.getAsset(assetId)) !== null,
      })
    },
    { label: 'Brand dispatch card', summary: 'Byte-budgeted brand card + injection-record meta; notFound for missing/draft brands' },
  )

  ctx.hooks.register(
    'brands.list',
    () => {
      const { brands } = listBrands()
      return {
        brands: brands
          .filter((b) => !b.draft)
          .map((b) => ({ id: b.id, name: b.name, description: b.description })),
      }
    },
    { label: 'List brands', summary: 'Published brand summaries for pickers (drafts excluded)' },
  )
}
