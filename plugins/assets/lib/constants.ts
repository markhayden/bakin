/**
 * Asset type constants and MIME type mappings.
 *
 * The image rows of `EXTENSION_TO_MIME` compose from the canonical
 * `IMAGE_EXTENSION_TO_MIME` in `@bakin/core/media/image-format` (#380) — a pure
 * module (no node imports) so this file stays safe in the client bundle. Adding
 * an image format is a one-place edit in core; audio/video/doc rows + asset-type
 * classification stay here (not media-generation concerns).
 */
import { IMAGE_EXTENSION_TO_MIME } from '@bakin/core/media/image-format'

export const ASSET_TYPES = ['text', 'images', 'video', 'audio', 'plans', 'research', 'pdf', 'data', 'other'] as const
export type AssetType = typeof ASSET_TYPES[number]

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
  '.pdf': 'pdf',
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
  // Images — single source of truth in @bakin/core/media/image-format (#380)
  ...IMAGE_EXTENSION_TO_MIME,
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

const EDITABLE_MIMES = new Set([
  'text/markdown',
  'text/plain',
  'application/rtf',
  'text/yaml',
  'application/yaml',
  'application/json',
  'text/csv',
  'text/tab-separated-values',
  'application/xml',
])

export function isEditableMimeType(mime: string): boolean {
  return EDITABLE_MIMES.has(mime)
}
