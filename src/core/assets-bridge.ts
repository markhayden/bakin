/**
 * Assets bridge — the SANCTIONED crossing from core/host into the assets plugin.
 *
 * This is the ONLY module under `src/` or `packages/host/src/` allowed to
 * import `plugins/assets/*` (allowlisted by
 * `tests/architecture/plugin-boundaries.test.ts`). Everything core needs from
 * the versioned asset store — `ctx.assets` (see
 * `src/lib/plugin-context-services.ts`), exec tools like `post-channel` —
 * goes through the typed async functions here, never through a direct plugin
 * import.
 *
 * The asset service is dynamic-imported lazily on first use (preserving the
 * pre-bridge lazy-loading behavior from plugin-context-services), so loading
 * this module never pulls the assets plugin's implementation at startup.
 */
import type {
  AssetCreateInput,
  AssetFileRef,
  AssetSummary,
  AssetVersionInput,
  AssetExportInput,
} from '../../plugins/assets/lib/asset-service'
import type { AssetManifest, AssetVersion } from '../../plugins/assets/lib/manifest'

// Re-exported so bridge consumers (core code) can type their locals without
// importing from the plugin themselves.
export type {
  AssetCreateInput,
  AssetFileRef,
  AssetSummary,
  AssetVersionInput,
  AssetExportInput,
  AssetManifest,
  AssetVersion,
}

type AssetService = typeof import('../../plugins/assets/lib/asset-service')

function service(): Promise<AssetService> {
  return import('../../plugins/assets/lib/asset-service')
}

/** Create a new versioned asset (v1) from a source file. */
export async function createAsset(input: AssetCreateInput): Promise<{ assetId: string; version: number }> {
  const { createAsset: create } = await service()
  const r = await create(input)
  return { assetId: r.assetId, version: r.version }
}

/** Current-version summary of an asset by id, or null. */
export async function getAssetSummary(assetId: string): Promise<AssetSummary | null> {
  const { getAssetSummary: get } = await service()
  return get(assetId)
}

/** Full manifest of an asset by id (versions + exports), or null. */
export async function getAssetManifest(assetId: string): Promise<AssetManifest | null> {
  const { getAsset } = await service()
  return getAsset(assetId)
}

/** Append a new version to an existing asset; advances the current pointer. */
export async function addVersion(assetId: string, input: AssetVersionInput): Promise<{ assetId: string; version: number }> {
  const { addVersion: add } = await service()
  const r = await add(assetId, input)
  return { assetId: r.assetId, version: r.version }
}

/** Render a derived export of a version (keyed/idempotent by surface). */
export async function addExport(assetId: string, input: AssetExportInput): Promise<{ name: string; file: string }> {
  const { addExport: add } = await service()
  const r = await add(assetId, input)
  return { name: r.name, file: r.file }
}

/** Resolve an asset version (default: current) to its on-disk file, or null. */
export async function resolveVersionFile(assetId: string, version?: number): Promise<AssetFileRef | null> {
  const { resolveFile } = await service()
  return resolveFile(assetId, version)
}

/** List asset summaries, optionally filtered by type / taskId / tags. */
export async function listAssets(filter?: { type?: AssetCreateInput['type']; taskId?: string | null; tags?: string[] }): Promise<AssetSummary[]> {
  const { listAssets: list } = await service()
  return list(filter)
}

/** Source-path-keyed upsert: create v1, append a changed version, or no-op. */
export async function upsertFromSource(
  sourcePath: string,
  input: AssetCreateInput,
): Promise<{ assetId: string; version: number; changed: boolean }> {
  const { upsertFromSource: upsert } = await service()
  return upsert(sourcePath, input)
}

/**
 * Map an absolute path INSIDE the asset store back to its asset identity.
 * `absPath` in the result is always the REAL version file (never the thumb).
 */
export async function resolveStoreFile(absPath: string): Promise<{ assetId: string; version: number; absPath: string } | null> {
  const { resolveStoreFile: resolve } = await service()
  return resolve(absPath)
}
