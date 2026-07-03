/**
 * Client-side shapes for the versioned (asset-as-directory) model. Mirrors the
 * server manifest types but is defined here so the client bundle never imports
 * server code (sharp/fs).
 */
export interface VersionedAssetSummary {
  assetId: string
  type: string
  agent: string
  taskId: string | null
  created: string
  updated: string
  currentVersion: number
  versionCount: number
  description: string
  tags: string[]
  mimeType: string
  width: number | null
  height: number | null
  size: number
  hasThumb: boolean
  /** Derived-metadata state for the current version ('stale' = enriched for an older version). */
  enrichment: 'none' | 'pending' | 'done' | 'stale' | 'failed' | 'skipped'
}

export interface TrashedAssetSummary {
  trashName: string
  assetId: string
  type: string
  agent: string
  deletedAt: number
  versionCount: number
  description: string
}

/** Client mirror of the manifest enrichment block (lib/manifest.ts). */
export interface AssetEnrichmentInfo {
  status: 'pending' | 'done' | 'failed' | 'skipped'
  caption?: string
  ocrText?: string
  suggestedTags?: string[]
  summary?: string
  transcript?: string
  model?: string
  at?: string
  forVersion?: number
  error?: string
  userEdited?: boolean
}

export interface AssetGenerationInfo {
  provider: string
  model: string
  surface: string
  /** Honored only on the shim path; native generations omit it (#379). */
  quality?: string
  routeSource: string
  routeReason?: string
  /** Reference/context images that conditioned this generation (#418). */
  references?: Array<{ assetId: string; version: number }>
}

export interface AssetVersion {
  version: number
  file: string
  thumb: string | null
  mimeType: string
  size: number
  width: number | null
  height: number | null
  created: string
  description: string
  tags: string[]
  op: 'generate' | 'edit' | 'upload' | 'import'
  parentVersion: number | null
  tool: string | null
  prompt: string | null
  promptHash: string | null
  generation: AssetGenerationInfo | null
}

export interface AssetExport {
  name: string
  surface: string
  format: string
  file: string
  width: number | null
  height: number | null
  fromVersion: number
  created: string
}

export interface VersionedAssetManifest {
  assetId: string
  type: string
  source: { kind: string; path: string | null }
  agent: string
  taskId: string | null
  created: string
  updated: string
  currentVersion: number
  description: string
  tags: string[]
  versions: AssetVersion[]
  exports: AssetExport[]
  enrichment?: AssetEnrichmentInfo
}
