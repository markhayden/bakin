/**
 * Asset manifest — the single source of truth for a versioned asset.
 *
 * One `manifest.json` per asset directory holds asset-level metadata plus the
 * full `versions[]` and `exports[]`. The old per-file `.meta.json` sidecar is
 * retired. Writes are atomic (temp + rename) because the manifest is read on
 * every serve AND is the search-reindex trigger — a torn write must never be
 * observable. Reads tolerate a transient parse failure (return null) rather
 * than throw.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteJson } from '@bakin/core/storage/atomic-write'

import { taskAssetIndexUpsert } from './task-asset-index'

export const ASSET_SOURCE_KINDS = ['generated', 'upload', 'import', 'clipboard', 'workspace-file'] as const
export const ASSET_OPS = ['generate', 'edit', 'upload', 'import'] as const

const GenerationSchema = z.object({
  provider: z.string(),
  model: z.string(),
  surface: z.string(),
  // Optional: quality is honored only on the direct-provider shim path. The
  // native runtime (OpenClaw) has no quality knob, so native generations omit
  // it rather than record a tier they never applied (#379).
  quality: z.string().optional(),
  routeSource: z.string(),
  routeReason: z.string().optional(),
  // Reference/context images that conditioned this generation, by managed
  // asset identity (#418). Lineage Bakin owns at the persist step — the runtime
  // only ever saw opaque file paths.
  references: z.array(z.object({
    assetId: z.string(),
    version: z.number().int().positive(),
  })).optional(),
})

export const AssetVersionSchema = z.object({
  version: z.number().int().positive(),
  file: z.string().min(1),
  thumb: z.string().nullable(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  created: z.string(),
  // Per-version display field. Asset-level description mirrors the current
  // version's, so promote/delete losslessly restore the right display. Tags are
  // deliberately NOT versioned — they're an asset-level organizational
  // namespace that must survive addVersion/promote (old manifests' version
  // tags are stripped by parse).
  description: z.string(),
  op: z.enum(ASSET_OPS),
  parentVersion: z.number().int().positive().nullable(),
  tool: z.string().nullable(),
  prompt: z.string().nullable(),
  promptHash: z.string().nullable(),
  generation: GenerationSchema.nullable(),
})

export const AssetExportSchema = z.object({
  name: z.string().min(1),
  surface: z.string(),
  format: z.string(),
  file: z.string().min(1),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  fromVersion: z.number().int().positive(),
  created: z.string(),
})

export const AssetSourceSchema = z.object({
  kind: z.enum(ASSET_SOURCE_KINDS),
  path: z.string().nullable(),
})

export const ASSET_ENRICHMENT_STATUSES = ['pending', 'done', 'failed', 'skipped'] as const

/**
 * Derived metadata a vision model produced from the asset ITSELF (caption,
 * OCR text, transcript, …). Lives in the manifest — durable, user-editable,
 * survives any index rebuild without re-billing (spec D8). Absent fields
 * mean "not derived"; nothing here is ever fabricated.
 */
export const AssetEnrichmentSchema = z.object({
  status: z.enum(ASSET_ENRICHMENT_STATUSES),
  caption: z.string().optional(),
  ocrText: z.string().optional(),
  suggestedTags: z.array(z.string()).optional(),
  summary: z.string().optional(),
  transcript: z.string().optional(),
  /** provider/model that produced it (e.g. anthropic/claude-haiku-4-5). */
  model: z.string().optional(),
  at: z.string().optional(),
  /** The version the enrichment describes; re-enrich when it trails currentVersion. */
  forVersion: z.number().int().positive().optional(),
  /** Last failure detail (doctor surfaces it; retry clears it). */
  error: z.string().optional(),
  /** Manual edits are never clobbered by re-enrichment (unless forced). */
  userEdited: z.boolean().optional(),
})

export const AssetManifestSchema = z.object({
  assetId: z.string().min(1),
  type: z.string().min(1),
  source: AssetSourceSchema,
  agent: z.string(),
  taskId: z.string().nullable(),
  created: z.string(),
  updated: z.string(),
  currentVersion: z.number().int().positive(),
  description: z.string(),
  tags: z.array(z.string()),
  versions: z.array(AssetVersionSchema).min(1),
  exports: z.array(AssetExportSchema),
  enrichment: AssetEnrichmentSchema.optional(),
})

export type AssetGeneration = z.infer<typeof GenerationSchema>
export type AssetVersion = z.infer<typeof AssetVersionSchema>
export type AssetExport = z.infer<typeof AssetExportSchema>
export type AssetSource = z.infer<typeof AssetSourceSchema>
export type AssetManifest = z.infer<typeof AssetManifestSchema>
export type AssetEnrichment = z.infer<typeof AssetEnrichmentSchema>

export const MANIFEST_FILENAME = 'manifest.json'

/** Read + validate the manifest in an asset directory, or null (missing/torn/invalid). */
export function readManifest(assetDirAbs: string): AssetManifest | null {
  const p = join(assetDirAbs, MANIFEST_FILENAME)
  if (!existsSync(p)) return null
  try {
    const parsed = AssetManifestSchema.safeParse(JSON.parse(readFileSync(p, 'utf-8')))
    return parsed.success ? parsed.data : null
  } catch {
    // Transient torn read during a concurrent write — caller retries next tick.
    return null
  }
}

/** Atomically write the manifest (temp file + rename on the same filesystem). */
export function writeManifestAtomic(assetDirAbs: string, manifest: AssetManifest): void {
  const validated = AssetManifestSchema.parse(manifest)
  const dest = join(assetDirAbs, MANIFEST_FILENAME)
  atomicWriteJson(dest, validated, { trailingNewline: false })
  // Single choke point for every asset mutation — keep the taskId index in
  // sync synchronously so the very next dispatch sees the link (the content
  // watcher's onSync is debounced and only acts as the self-heal backstop).
  taskAssetIndexUpsert(validated.assetId, validated.taskId ?? null)
}
