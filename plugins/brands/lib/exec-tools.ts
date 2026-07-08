/**
 * Brand exec tools (#419, spec §7.2) — the pull-based tier of the two-tier
 * card model. The dispatch card lists what exists; agents fetch what the
 * task needs through these. Read-only in T2.1 (add_lesson lands in T3.2;
 * draft-gated write tools in T6.2 — agents never mutate published brand
 * identity).
 */
import { z } from 'zod'
import type { PluginContext } from '@bakin/core/plugin-types'
import { getBrand, listBrands, listDocs, readDoc, writeDoc, updateBrand } from './store'
import { computeBrandFingerprint } from './fingerprint'
import { paletteEntrySchema, terminologyEntrySchema } from './schemas'

/** Draft gate (§9.1): agents NEVER mutate published brand identity. */
function requireDraftBrand(brandId: string): { ok: true } | { ok: false; error: string } {
  const read = getBrand(brandId)
  if (read.status !== 'ok') return { ok: false, error: `brand not found: ${brandId}` }
  if (!read.manifest.draft) {
    return {
      ok: false,
      error: `brand '${brandId}' is PUBLISHED — agents may not edit live brand identity. Use bakin_exec_brands_add_lesson for learnings, or ask the operator to edit the brand.`,
    }
  }
  return { ok: true }
}

const lessonSlug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'lesson'

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
      // Caption join (S7): agents pick the RIGHT screenshot by caption.
      let assetDetails: Record<string, unknown> = {}
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
      } catch { /* best-effort — the brand view never breaks over assets */ }
      return {
        ok: true,
        brand: read.manifest,
        guidelines: listDocs(brandId, 'guidelines'),
        lessons: listDocs(brandId, 'lessons'),
        fingerprint: computeBrandFingerprint(brandId),
        assetDetails,
      }
    },
  })

  ctx.registerExecTool({
    name: 'bakin_exec_brands_write_doc',
    label: 'Wrote a draft-brand doc',
    description:
      'DRAFT BRANDS ONLY (builder flow): write a guideline or lesson doc while authoring a brand. Typed error on published brands — live brand identity is operator-only.',
    parameters: {
      brandId: z.string().describe('Draft brand id'),
      kind: z.enum(['guidelines', 'lessons']).describe('Doc kind'),
      name: z.string().describe('Doc filename ending in .md, e.g. voice.md'),
      content: z.string().describe('Full markdown content (frontmatter description: recommended)'),
    },
    handler: async (params) => {
      const brandId = String(params.brandId ?? '')
      const gate = requireDraftBrand(brandId)
      if (!gate.ok) return { ok: false, error: gate.error }
      const kind = params.kind === 'lessons' ? 'lessons' as const : 'guidelines' as const
      try {
        writeDoc(brandId, kind, String(params.name ?? ''), String(params.content ?? ''))
        return { ok: true, brandId, doc: `${kind}/${params.name}` }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  ctx.registerExecTool({
    name: 'bakin_exec_brands_update_manifest',
    label: 'Updated a draft-brand manifest',
    description:
      'DRAFT BRANDS ONLY (builder flow): set description, palette, rules, terminology, and/or cardDocs while authoring a brand. Typed error on published brands.',
    parameters: {
      brandId: z.string().describe('Draft brand id'),
      description: z.string().optional().describe('One-line brand description'),
      palette: z.array(paletteEntrySchema).optional().describe('Structured colors [{name, hex, usage?}]'),
      rules: z.array(z.string()).optional().describe('Absolute imperatives, e.g. "Never use emojis"'),
      terminology: z.array(terminologyEntrySchema).optional().describe('Do/don\'t term pairs [{term, rule}]'),
      cardDocs: z.array(z.string()).optional().describe('Guideline filenames inlined into the dispatch card'),
    },
    handler: async (params) => {
      const brandId = String(params.brandId ?? '')
      const gate = requireDraftBrand(brandId)
      if (!gate.ok) return { ok: false, error: gate.error }
      try {
        const brand = await updateBrand(brandId, (m) => ({
          ...m,
          ...(params.description !== undefined ? { description: String(params.description) } : {}),
          ...(params.palette !== undefined ? { palette: params.palette as never } : {}),
          ...(params.rules !== undefined ? { rules: params.rules as never } : {}),
          ...(params.terminology !== undefined ? { terminology: params.terminology as never } : {}),
          ...(params.cardDocs !== undefined ? { cardDocs: params.cardDocs as never } : {}),
        }))
        return { ok: true, brand }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  ctx.registerExecTool({
    name: 'bakin_exec_brands_add_lesson',
    label: 'Added a brand lesson',
    description:
      'Bank a brand learning from this task (e.g. "thread format flopped on LinkedIn — use single posts"). Append-only: the ONLY write agents may make to a published brand. Absolute always-rules belong in the brand\'s Rules list (ask the operator), not lessons.',
    parameters: {
      brandId: z.string().describe('Brand id'),
      title: z.string().describe('Short lesson title'),
      body: z.string().describe('The lesson: what happened, what to do instead'),
    },
    handler: async (params, agent) => {
      const brandId = String(params.brandId ?? '')
      const title = String(params.title ?? '').trim()
      const body = String(params.body ?? '').trim()
      if (!title || !body) return { ok: false, error: 'title and body are required' }
      const read = getBrand(brandId)
      if (read.status !== 'ok') return { ok: false, error: `brand not found: ${brandId}` }

      // Append-only: never overwrite an existing lesson file.
      let name = `${lessonSlug(title)}.md`
      if (readDoc(brandId, 'lessons', name) !== null) {
        name = `${lessonSlug(title)}-${Date.now().toString(36)}.md`
      }
      try {
        writeDoc(brandId, 'lessons', name, `---\ntitle: ${title}\n---\n\n${body}\n`)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      try {
        ctx.activity.audit('brand.lesson_added', agent, { brandId, lesson: name, title })
        ctx.events.emit('brand.changed', { brandId })
      } catch { /* activity surface unavailable (tests) */ }
      return { ok: true, brandId, lesson: name }
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
