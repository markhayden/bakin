/**
 * Unified curated-catalog schema (v2).
 *
 * One catalog file covers every discoverable kind: agents, plugins, and
 * packs. Replaces the former curated-agents.json / curated-plugins.json
 * pair. The shipped file lives at packages/host/src/data/curated-catalog.json
 * (embedded into the binary); the same schema validates remotely refreshed
 * catalogs fetched by the explore plugin.
 */
import { z } from 'zod'

export const CATALOG_KINDS = [
  'agent',
  'plugin',
  'skill-pack',
  'workflow-pack',
  'lesson-pack',
] as const

export type CatalogKind = (typeof CATALOG_KINDS)[number]

export const CatalogEntrySchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(CATALOG_KINDS),
    name: z.string().min(1),
    emoji: z.string().optional(),
    description: z.string(),
    category: z.string().min(1),
    tags: z.array(z.string()).default([]),
    useCases: z.array(z.string()).default([]),
    source: z.string().min(1).optional(),
    ref: z.string().nullable().default(null),
    trust: z.enum(['official', 'verified', 'community']).default('community'),
    /** Ships inside the Bakin binary — always installed, never installable. */
    builtin: z.boolean().default(false),
    /** Plugin ids this entry depends on (plugin kind only). */
    dependencies: z.array(z.string()).default([]),
    /** Pre-selected during onboarding recommendation flows. */
    defaultSelected: z.boolean().default(false),
    iconUrl: z.string().optional(),
    /**
     * Gallery image URLs (screenshots, promo art) rendered in the Explore
     * detail drawer. Authored in the bits-repo catalog; the UI shows
     * placeholder frames until entries ship real assets.
     */
    screenshots: z.array(z.string()).default([]),
  })
  .refine((entry) => entry.builtin || entry.source !== undefined, {
    message: 'non-builtin entries must declare a source',
  })

export const CatalogFileSchema = z.object({
  version: z.literal(2),
  updatedAt: z.string(),
  entries: z.array(CatalogEntrySchema),
})

export type CatalogEntry = z.infer<typeof CatalogEntrySchema>
export type CatalogFile = z.infer<typeof CatalogFileSchema>
