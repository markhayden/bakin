/**
 * Brand manifest schemas (#419, spec §3.2/§3.4).
 *
 * Two shapes, one converter boundary: the INSTALLED manifest (brand.json on
 * disk — references managed assets by assetId) and the PORTABLE manifest
 * (repo/export shape — references files by relative path, since a repo cannot
 * contain machine-local asset ids). The importer/exporter in lib/portable.ts
 * is the only code allowed to convert between them.
 *
 * Structure exists only for what machines read (palette, rules, asset refs);
 * everything agents read is freeform markdown under guidelines/ and lessons/.
 */
import { z } from 'zod'

/** Kebab-case slug; the id IS the directory name under ~/.bakin/brands/. */
export const brandIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'brand id must be a kebab-case slug')

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'hex color must be #RRGGBB')

export const paletteEntrySchema = z.object({
  name: z.string().min(1),
  hex: hexColor,
  usage: z.string().optional(),
})

export const terminologyEntrySchema = z.object({
  term: z.string().min(1),
  rule: z.string().min(1),
})

/** Import provenance — set only by the importer. */
export const brandSourceSchema = z.object({
  repo: z.string().min(1),
  ref: z.string().optional(),
  commit: z.string().optional(),
  importedAt: z.string(),
})

const sharedManifestFields = {
  id: brandIdSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  palette: z.array(paletteEntrySchema),
  /** Short absolute imperatives — ALWAYS inline in the card, never retrieval-dependent. */
  rules: z.array(z.string().min(1)).optional(),
  terminology: z.array(terminologyEntrySchema).optional(),
  /** Guideline filenames inlined into the dispatch card (default: voice.md if present). */
  cardDocs: z.array(z.string().min(1)).optional(),
  /** Lesson filenames kept on disk but excluded from retrieval/injection (the per-lesson off switch). */
  disabledLessons: z.array(z.string().min(1)).optional(),
}

export const brandManifestSchema = z.object({
  ...sharedManifestFields,
  /** Draft brands (builder flow) are excluded from pickers, resolution, and injection. */
  draft: z.boolean().optional(),
  /** The builder's drafting task — the detail banner shows its live status. Cleared on publish. */
  draftTaskId: z.string().optional(),
  logos: z.array(z.object({ assetId: z.string().min(1), variant: z.string().min(1) })),
  assetGroups: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      assetIds: z.array(z.string().min(1)),
    }),
  ),
  /** Auto-attached to brand-conditioned generation when the agent passes no references. */
  defaultImageReferences: z.array(z.string().min(1)).max(4).optional(),
  source: brandSourceSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const portableBrandSchema = z.object({
  ...sharedManifestFields,
  logos: z.array(z.object({ file: z.string().min(1), variant: z.string().min(1) })),
  assetGroups: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        files: z.array(z.string().min(1)),
      }),
    )
    .optional(),
  defaultImageReferences: z.array(z.string().min(1)).max(4).optional(),
})

export type BrandManifest = z.infer<typeof brandManifestSchema>
export type PortableBrand = z.infer<typeof portableBrandSchema>
export type PaletteEntry = z.infer<typeof paletteEntrySchema>
export type TerminologyEntry = z.infer<typeof terminologyEntrySchema>
export type BrandSource = z.infer<typeof brandSourceSchema>
