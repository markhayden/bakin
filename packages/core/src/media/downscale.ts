/**
 * THE pre-send image seam shared by every surface that sends image
 * attachments to a model (assets enrichment, chat): turn a file into
 * something a vision model's image lane accepts, or say exactly why not.
 *
 * - A vision-raster image (`VISION_RASTER_MIMES`) at or under the 2 MB inline
 *   cap passes through untouched — gateway attachments hard-cap at 2 MB
 *   (larger silently degrades upstream: the model never sees pixels,
 *   bakin#583 territory).
 * - A raster image over the cap is downscaled to a temp JPEG.
 * - Any OTHER image (SVG, TIFF, HEIF, …) is rasterized (#855): PNG first so
 *   logos keep their transparency, JPEG on white when the PNG would not fit.
 *   Providers reject `image/svg+xml` outright, so sending it raw only ever
 *   bought a billed failure.
 *
 * Failures are typed (`ImageNotSendableError.reason`) — callers branch on the
 * reason, never on message text. Decoding and encoding run in memory through
 * sharp, so a failure there is the IMAGE's fault (`unrasterizable`); the temp
 * file is written with plain fs calls, so a disk error stays a disk error
 * (untyped, retryable) and is never mistaken for a bad image.
 */
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { isVisionRasterMime } from './image-format'
import { loadSharp, type Sharp } from './sharp-loader'

export const INLINE_ATTACHMENT_LIMIT_BYTES = 2_000_000
const MAX_DIMENSION = 1568
const JPEG_QUALITY = 85
/** Decode bound: refuse inputs over ~100 MP (a 48 MP phone photo still fits). */
const MAX_INPUT_PIXELS = 100_000_000
/** Small vector art renders at this long edge (density-scaled up; never past MAX_DIMENSION). */
const VECTOR_TARGET_DIMENSION = 1024

export interface PreparedAttachment {
  path: string
  mimeType: string
  /** True when the seam wrote a temp file the caller must clean up. */
  owned: boolean
}

export type ImageNotSendableReason =
  /** sharp is not installed — retryable once `bakin install media` runs. */
  | 'sharp_unavailable'
  /** sharp is present but cannot decode this file (unsupported codec, corrupt bytes). */
  | 'unrasterizable'
  /** Still over the inline cap after downscaling. */
  | 'too_large'

export class ImageNotSendableError extends Error {
  readonly reason: ImageNotSendableReason
  constructor(reason: ImageNotSendableReason, message: string) {
    super(message)
    this.name = 'ImageNotSendableError'
    this.reason = reason
  }
}

const INSTALL_MEDIA_FIX = 'Fix: run `bakin install media` (or Health → "Install image processing") — retrying without it can never succeed.'

/**
 * Returns the original when it already fits the image lane; otherwise a temp
 * file the caller owns (`owned: true` — release it with
 * `cleanupPreparedAttachment`). Throws `ImageNotSendableError` when the image
 * cannot be made sendable; never sends an oversized or non-raster file.
 */
export async function prepareImageAttachment(path: string, mimeType: string): Promise<PreparedAttachment> {
  const raster = isVisionRasterMime(mimeType)
  const size = statSync(path).size
  if (raster && size <= INLINE_ATTACHMENT_LIMIT_BYTES) return { path, mimeType, owned: false }

  const sharp = await loadSharp()
  if (!sharp) {
    throw new ImageNotSendableError('sharp_unavailable', raster
      ? `attachment ${path}: ${size} bytes exceeds the ${INLINE_ATTACHMENT_LIMIT_BYTES}-byte inline limit and sharp is unavailable to downscale it — larger images silently degrade upstream (the model never sees the pixels). ${INSTALL_MEDIA_FIX}`
      : `attachment ${path}: ${mimeType} is not an image type vision models accept and sharp is unavailable to convert it. ${INSTALL_MEDIA_FIX}`)
  }

  const encoded = raster ? await downscaleRaster(sharp, path) : await rasterize(sharp, path, mimeType)
  if (encoded.data.length > INLINE_ATTACHMENT_LIMIT_BYTES) {
    throw new ImageNotSendableError('too_large',
      `attachment ${path}: still ${encoded.data.length} bytes after converting to ${MAX_DIMENSION}px — refusing to send (would silently degrade upstream).`)
  }

  const outDir = mkdtempSync(join(tmpdir(), 'bakin-downscale-'))
  try {
    const outPath = join(outDir, encoded.mimeType === 'image/png' ? 'attachment.png' : 'attachment.jpg')
    writeFileSync(outPath, encoded.data)
    return { path: outPath, mimeType: encoded.mimeType, owned: true }
  } catch (err) {
    rmSync(outDir, { recursive: true, force: true })
    throw err
  }
}

interface Encoded {
  data: Buffer
  mimeType: 'image/png' | 'image/jpeg'
}

async function decodeStep<T>(path: string, mimeType: string, step: () => Promise<T>): Promise<T> {
  try {
    return await step()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new ImageNotSendableError('unrasterizable', `attachment ${path}: cannot decode ${mimeType} for the image lane (${detail}).`)
  }
}

async function downscaleRaster(sharp: Sharp, path: string): Promise<Encoded> {
  const data = await decodeStep(path, 'image', () => sharp(path, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate() // honor EXIF orientation before stripping metadata
    .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer())
  return { data, mimeType: 'image/jpeg' }
}

async function rasterize(sharp: Sharp, path: string, mimeType: string): Promise<Encoded> {
  const meta = await decodeStep(path, mimeType, () => sharp(path, { limitInputPixels: MAX_INPUT_PIXELS }).metadata())
  // Vector art renders at its declared size by default (often a few dozen
  // px) — scale small art up to a readable size through density. Applied
  // only below the target, and computed to land ON it, so the render is
  // bounded by VECTOR_TARGET_DIMENSION by construction.
  const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0)
  const density = meta.format === 'svg' && longEdge > 0 && longEdge < VECTOR_TARGET_DIMENSION
    ? (meta.density ?? 72) * (VECTOR_TARGET_DIMENSION / longEdge)
    : undefined
  // First frame/page only (sharp's default) — animation and multipage
  // extraction are out of scope for a single image-lane attachment.
  const base = () => sharp(path, { limitInputPixels: MAX_INPUT_PIXELS, ...(density ? { density } : {}) })
    .rotate()
    .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
  const png = await decodeStep(path, mimeType, () => base().png().toBuffer())
  if (png.length <= INLINE_ATTACHMENT_LIMIT_BYTES) return { data: png, mimeType: 'image/png' }
  const jpeg = await decodeStep(path, mimeType, () => base().flatten({ background: '#ffffff' }).jpeg({ quality: JPEG_QUALITY }).toBuffer())
  return { data: jpeg, mimeType: 'image/jpeg' }
}

/**
 * Remove the temp file the seam wrote. Callers own the lifetime — e.g. the
 * enrichment queue calls this after its LAST send (retries reuse the file).
 * No-op for originals.
 */
export function cleanupPreparedAttachment(prepared: PreparedAttachment): void {
  if (!prepared.owned) return
  rmSync(dirname(prepared.path), { recursive: true, force: true })
}
