/**
 * Cross-plugin hooks (#419, spec §7.1).
 *
 * The ONLY way other plugins and core reach brand data — no direct imports
 * (architecture-test enforced). `brands.get` returns draft brands with the
 * flag visible (consumers like images decide how to treat drafts);
 * `brands.list` excludes drafts entirely so pickers can never offer one.
 */
import type { PluginContext } from '@bakin/core/plugin-types'
import { createLogger } from '../../../src/core/logger'
import { getBrand, listBrands, listDocs } from './store'
import { computeBrandFingerprint } from './fingerprint'
import { buildBrandCard, type BrandCardInput } from './card'
import { retrieveBrandLessons } from './lesson-retrieval'

const log = createLogger('brands')

// Audit lessons-unavailable at most once per brand per window — the marker in
// every card is the per-dispatch signal; the audit row is the incident.
const lessonsUnavailableAudited = new Map<string, number>()
const LESSONS_UNAVAILABLE_AUDIT_TTL_MS = 10 * 60_000

export function registerBrandsHooks(ctx: PluginContext): void {
  ctx.hooks.register(
    'brands.get',
    async (data: { brandId?: string }) => {
      if (!data?.brandId) return undefined
      const read = getBrand(data.brandId)
      if (read.status !== 'ok') return undefined
      // Caption join (S7): label group members via assets.describe so agents
      // pick the RIGHT screenshot, not a blind assetId. Best-effort — the
      // brand view never breaks over the assets plugin.
      let assetDetails: Record<string, { description: string; caption?: string; exists: boolean }> = {}
      try {
        if (ctx.hooks.has('assets.describe')) {
          const ids = [
            ...read.manifest.logos.map((l) => l.assetId),
            ...read.manifest.assetGroups.flatMap((g) => g.assetIds),
            ...(read.manifest.defaultImageReferences ?? []),
          ]
          if (ids.length) {
            assetDetails = (await ctx.hooks.invoke('assets.describe', { assetIds: [...new Set(ids)] })) ?? {}
          }
        }
      } catch {
        log.warn('assets.describe unavailable for brand caption join', { brandId: data.brandId })
      }
      return {
        manifest: read.manifest,
        guidelines: listDocs(read.manifest.id, 'guidelines'),
        lessons: listDocs(read.manifest.id, 'lessons'),
        fingerprint: computeBrandFingerprint(read.manifest.id),
        assetDetails,
      }
    },
    { label: 'Get brand', summary: 'Brand manifest + doc listings + fingerprint + asset captions (drafts included, flagged)' },
  )

  ctx.hooks.register(
    'brands.getContext',
    async (data: { brandId?: string; taskQuery?: string; maxBytes?: number; lessons?: BrandCardInput['lessons']; lessonsUnavailable?: boolean }) => {
      if (!data?.brandId) return { notFound: true }

      // Lessons tier (#419 §6): top-N by the task's query, faceted to the
      // brand. Engine-down degrades to a visible card marker + one audited
      // incident — never blocks dispatch. Explicit inputs (tests/preview)
      // bypass retrieval.
      let lessons = data.lessons
      let lessonsUnavailable = data.lessonsUnavailable ?? false
      if (lessons === undefined && !lessonsUnavailable && data.taskQuery) {
        const retrieved = await retrieveBrandLessons(data.brandId, data.taskQuery)
        if (retrieved.status === 'ok') {
          lessons = retrieved.lessons
        } else {
          lessonsUnavailable = true
          const last = lessonsUnavailableAudited.get(data.brandId) ?? 0
          if (Date.now() - last > LESSONS_UNAVAILABLE_AUDIT_TTL_MS) {
            lessonsUnavailableAudited.set(data.brandId, Date.now())
            try {
              ctx.activity.audit('brand.lessons_unavailable', 'system', { brandId: data.brandId })
            } catch {
              log.warn('brand.lessons_unavailable audit unavailable', { brandId: data.brandId })
            }
          }
        }
      }

      return buildBrandCard(data.brandId, {
        maxBytes: typeof data.maxBytes === 'number' && data.maxBytes > 0 ? data.maxBytes : 12288,
        lessons,
        lessonsUnavailable,
        assetExists: async (assetId) => (await ctx.assets.getAsset(assetId)) !== null,
      })
    },
    { label: 'Brand dispatch card', summary: 'Byte-budgeted brand card (+retrieved lessons) + injection-record meta; notFound for missing/draft brands' },
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
