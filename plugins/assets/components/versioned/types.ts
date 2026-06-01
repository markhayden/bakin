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

export interface AssetGenerationInfo {
  provider: string
  model: string
  surface: string
  quality: string
  routeSource: string
  routeReason?: string
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
}
