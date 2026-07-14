/**
 * Single source of truth for image-format mappings shared across the core↔plugin
 * boundary (#380).
 *
 * Two small tables previously drifted: the direct-image shim re-encoded a
 * mime→extension map (`extForMime`) and the provider→env-var names, while the
 * images/assets plugins owned their own copies. Core must not import plugin code,
 * so this PURE module (no node imports — safe in the browser bundle) is the one
 * place both sides consume. Adding a format or a provider credential is a
 * one-place edit.
 */

export type DirectImageProviderId = 'openai' | 'google'

/** Canonical image extension → mime. The image rows of the assets plugin's
 *  broader `EXTENSION_TO_MIME` compose from this so they can never disagree. */
export const IMAGE_EXTENSION_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
}

/** Preferred mime → extension (controls the jpg-vs-jpeg choice for image/jpeg). */
const MIME_TO_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
}

/**
 * Bare file extension (no dot) for a provider-returned image mime. Strips mime
 * parameters and casing. Unknown mimes fall back to `png` (the common
 * provider-output format) rather than silently mistyping — fixing the prior
 * `image/gif → .jpg` bug that #380 was filed for.
 */
/**
 * Mime type from an image file path's extension — pure string logic.
 * Null for anything that isn't a supported input type: callers must reject
 * (never guess a mime and send mislabeled bytes to a billed provider call).
 */
export function mimeTypeForImagePath(path: string): string | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return null
}

export function extensionForImageMime(mimeType: string): string {
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  return MIME_TO_EXTENSION[normalized] ?? 'png'
}

/**
 * Provider → credential env-var names, in resolution order (first present wins).
 * Consumed by the shim's `resolveDirectImageKey`, the images plugin's provider
 * readiness, and validated against the images manifest `secrets`.
 */
export const IMAGE_PROVIDER_ENV_VARS: Record<DirectImageProviderId, string[]> = {
  openai: ['OPENAI_API_KEY'],
  google: ['GEMINI_API_KEY', 'GOOGLE_AI_API_KEY'],
}
