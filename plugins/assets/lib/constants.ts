/**
 * Asset type constants and MIME type mappings.
 */

export const ASSET_TYPES = ['text', 'images', 'video', 'audio', 'plans', 'data', 'other'] as const
export type AssetType = typeof ASSET_TYPES[number]

export const SPECIAL_DIRS = ['_unlinked', 'library', '.trash'] as const

export const EXTENSION_TO_TYPE: Record<string, AssetType> = {
  // Text
  '.md': 'text',
  '.txt': 'text',
  '.rtf': 'text',
  // Images
  '.png': 'images',
  '.jpg': 'images',
  '.jpeg': 'images',
  '.gif': 'images',
  '.webp': 'images',
  '.svg': 'images',
  '.bmp': 'images',
  '.ico': 'images',
  // Video
  '.mp4': 'video',
  '.mov': 'video',
  '.webm': 'video',
  '.avi': 'video',
  '.mkv': 'video',
  // Audio
  '.mp3': 'audio',
  '.wav': 'audio',
  '.m4a': 'audio',
  '.ogg': 'audio',
  '.flac': 'audio',
  '.aac': 'audio',
  // Plans
  '.yaml': 'plans',
  '.yml': 'plans',
  // Documents
  '.pdf': 'other',
  // Data
  '.json': 'data',
  '.csv': 'data',
  '.tsv': 'data',
  '.xml': 'data',
}

export const EXTENSION_TO_MIME: Record<string, string> = {
  // Text
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.rtf': 'application/rtf',
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  // Video
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  // Plans
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  // Documents
  '.pdf': 'application/pdf',
  // Data
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.xml': 'application/xml',
}

export function getAssetType(filename: string): AssetType {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase()
  return EXTENSION_TO_TYPE[ext] || 'other'
}

export function getMimeType(filename: string): string {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase()
  return EXTENSION_TO_MIME[ext] || 'application/octet-stream'
}
