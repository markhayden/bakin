/**
 * Single source for versioned-asset URLs (path-segment scheme). No component
 * hand-rolls these. `bust` is the asset's currentVersion/updated so a
 * promote/edit busts the browser cache (the server ETag is keyed the same way).
 */
const BASE = '/api/assets'

export function assetCurrentUrl(assetId: string, bust?: string | number): string {
  return `${BASE}/${encodeURIComponent(assetId)}${bust != null ? `?v=${bust}` : ''}`
}

export function assetVersionUrl(assetId: string, version: number): string {
  return `${BASE}/${encodeURIComponent(assetId)}/v/${version}`
}

export function assetThumbUrl(assetId: string, version?: number): string {
  const id = encodeURIComponent(assetId)
  return version != null ? `${BASE}/${id}/v/${version}/thumb` : `${BASE}/${id}/thumb`
}

export function assetExportUrl(assetId: string, name: string): string {
  return `${BASE}/${encodeURIComponent(assetId)}/export/${encodeURIComponent(name)}`
}

/** Plugin API base for versioned mutations. */
export const VERSIONED_API = '/api/plugins/assets/versioned'

/** Multipart upload endpoint — one versioned asset (v1) per file. */
export const UPLOAD_API = '/api/plugins/assets/upload'
