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
    /**
     * REQUIRED, no default: the old readers treated a missing trust as
     * official while the first v2 draft defaulted it to community — the
     * silent divergence dropped entries from onboarding recommendations.
     * Catalog authors must state trust explicitly.
     */
    trust: z.enum(['official', 'verified', 'community']),
    /** Ships inside the Bakin binary — always installed, never installable. */
    builtin: z.boolean().default(false),
    /** Plugin ids this entry depends on (plugin kind only). */
    dependencies: z.array(z.string()).default([]),
    /** Pre-selected during onboarding recommendation flows. */
    defaultSelected: z.boolean().default(false),
    /**
     * Capability slug for capability packs (skill-packs that teach agents a
     * named capability, e.g. `web-search`). Drives the Explore Capabilities
     * shelf facet and per-capability readiness.
     */
    capability: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
      .optional(),
    /**
     * Runtime compatibility tags: `['*']` or adapter slugs (`pi`,
     * `openclaw`). Explore filters/badges against the ACTIVE runtime.
     */
    runtimes: z
      .array(z.string().regex(/^(\*|[a-z0-9][a-z0-9-]{0,31})$/))
      .min(1)
      .default(['*']),
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
