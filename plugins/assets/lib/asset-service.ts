/**
 * Versioned asset service — public barrel.
 *
 * An asset is a directory `assets/store/{YYYY-MM}/{assetId}/` containing a
 * `manifest.json` (source of truth) plus per-version files `v{n}.{ext}` and
 * thumbnails `v{n}.thumb.jpg`. The implementation is split across three cohesive
 * modules; this barrel re-exports their public surface so the consumers + tests
 * keep importing from `…/lib/asset-service`:
 *
 * - asset-core: creation + read paths (the cycle-free base + shared leaves)
 * - asset-mutations: version/metadata/tag/export mutations (per-asset lock)
 * - asset-upsert: the source-keyed dedup spine
 *
 * Type-agnostic: images are the first consumer, but any asset type uses the
 * same spine.
 */
export {
  createAsset,
  getAsset,
  assetExists,
  resolveFileFromManifest,
  resolveFile,
  getAssetSummary,
  listAssets,
  type AssetCreateInput,
  type AssetFileRef,
  type AssetSummary,
} from './asset-core'

export {
  addVersion,
  updateMetadata,
  renameTagGlobal,
  removeTagGlobal,
  applyTags,
  promoteVersion,
  deleteVersion,
  addExport,
  relink,
  retype,
  type AssetVersionInput,
  type AssetMetadataInput,
  type AssetExportInput,
} from './asset-mutations'

export {
  findBySourcePath,
  upsertFromSource,
  resolveStoreFile,
} from './asset-upsert'

export {
  consolidateAssets,
  type ConsolidateInput,
  type ConsolidateResult,
  type ConsolidateFailureCode,
} from './asset-consolidate'
