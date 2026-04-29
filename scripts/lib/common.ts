/**
 * Shared utilities for execution scripts.
 * Every scripts/lib/ module imports from here.
 */
import { execSync } from 'child_process'
import type { ExecToolResult } from '@bakin/core/plugin-types'

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

export function succeed(data: Record<string, unknown> = {}): ExecToolResult {
  return { ok: true, ...data }
}

export function fail(error: string, details?: unknown): ExecToolResult {
  return { ok: false, error, ...(details !== undefined ? { details } : {}) }
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

/**
 * Generate a URL/filename-safe slug from arbitrary text.
 * "Golden Hour Smoothie!!!" → "golden-hour-smoothie"
 */
export function slugify(text: string, maxLength = 60): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')   // remove non-word chars (except hyphens)
    .replace(/[\s_]+/g, '-')     // spaces/underscores → hyphens
    .replace(/-+/g, '-')         // collapse multiple hyphens
    .replace(/^-|-$/g, '')       // trim leading/trailing hyphens
    .slice(0, maxLength)
    .replace(/-$/, '')           // trim trailing hyphen after truncation
}

/**
 * Generate a date-prefixed filename: YYYYMMDD-slug.ext
 */
export function datePrefixedFilename(slug: string, ext: string): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const cleanExt = ext.startsWith('.') ? ext.slice(1) : ext
  return `${date}-${slug}.${cleanExt}`
}

// ---------------------------------------------------------------------------
// Retry with exponential backoff
// ---------------------------------------------------------------------------

export interface RetryOptions {
  maxAttempts?: number  // default: 3
  baseDelayMs?: number  // default: 1000
  maxDelayMs?: number   // default: 10000
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 1000, maxDelayMs = 10000 } = opts
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt === maxAttempts) break
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

// ---------------------------------------------------------------------------
// File extension extraction
// ---------------------------------------------------------------------------

export function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1 || dot === filePath.length - 1) return ''
  return filePath.slice(dot + 1).toLowerCase()
}

export function getBasename(filePath: string): string {
  const slash = filePath.lastIndexOf('/')
  const name = slash === -1 ? filePath : filePath.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  return dot === -1 ? name : name.slice(0, dot)
}

// ---------------------------------------------------------------------------
// ffmpeg thumbnail generation
// ---------------------------------------------------------------------------

/**
 * Generate a JPEG thumbnail from an image file.
 * Returns the output path, or null if ffmpeg fails.
 */
export function generateThumbnail(
  inputPath: string,
  outputPath: string,
  widthPx = 400,
): string | null {
  try {
    execSync(
      `ffmpeg -i "${inputPath}" -vf "scale=${widthPx}:-1" -q:v 5 -y "${outputPath}"`,
      { stdio: 'pipe', timeout: 30_000 },
    )
    return outputPath
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Image presets
// ---------------------------------------------------------------------------

export const IMAGE_PRESETS = {
  'social-portrait':  { width: 1080, height: 1920 },
  'social-square':    { width: 1080, height: 1080 },
  'social-landscape': { width: 1200, height: 675 },
} as const

export type ImagePreset = keyof typeof IMAGE_PRESETS | 'custom'

export const MAX_IMAGE_EDGE = 1200

/**
 * Resolve dimensions from a preset or custom values.
 * Caps custom dimensions at MAX_IMAGE_EDGE.
 */
export function resolveImageDimensions(
  preset: ImagePreset = 'social-portrait',
  customWidth?: number,
  customHeight?: number,
): { width: number; height: number } {
  if (preset !== 'custom') {
    return IMAGE_PRESETS[preset]
  }
  return {
    width: Math.min(customWidth || 1080, MAX_IMAGE_EDGE),
    height: Math.min(customHeight || 1920, MAX_IMAGE_EDGE),
  }
}
