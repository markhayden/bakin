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
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

export const ASSET_SOURCE_KINDS = ['generated', 'upload', 'import', 'clipboard', 'workspace-file'] as const
export const ASSET_OPS = ['generate', 'edit', 'upload', 'import'] as const

const GenerationSchema = z.object({
  provider: z.string(),
  model: z.string(),
  surface: z.string(),
  quality: z.string(),
  routeSource: z.string(),
  routeReason: z.string().optional(),
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
  // Per-version display fields. Asset-level description/tags mirror the current
  // version's, so promote/delete losslessly restore the right display.
  description: z.string(),
  tags: z.array(z.string()),
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
})

export type AssetGeneration = z.infer<typeof GenerationSchema>
export type AssetVersion = z.infer<typeof AssetVersionSchema>
export type AssetExport = z.infer<typeof AssetExportSchema>
export type AssetSource = z.infer<typeof AssetSourceSchema>
export type AssetManifest = z.infer<typeof AssetManifestSchema>

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
  const tmp = join(assetDirAbs, `.${MANIFEST_FILENAME}.${randomBytes(6).toString('hex')}.tmp`)
  writeFileSync(tmp, JSON.stringify(validated, null, 2), 'utf-8')
  renameSync(tmp, dest)
}
