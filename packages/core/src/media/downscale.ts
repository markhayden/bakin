/**
 * Pre-send image preparation shared by every surface that sends image
 * attachments to a runtime (assets enrichment, chat): gateway attachments
 * hard-cap at 2 MB inline (larger silently degrades upstream — the model
 * never sees pixels, bakin#583 territory), so anything bigger is downscaled
 * to a temp JPEG first. ~1568px max dimension keeps OCR-able detail while
 * landing far under the cap for photographic content.
 */
import { statSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { loadSharp } from './sharp-loader'

export const INLINE_ATTACHMENT_LIMIT_BYTES = 2_000_000
const MAX_DIMENSION = 1568
const JPEG_QUALITY = 85

export interface PreparedAttachment {
  path: string
  mimeType: string
  downscaled: boolean
}

/**
 * Returns the original when it already fits; otherwise a downscaled temp
 * JPEG. Throws (loudly, with the silent-degradation rationale) when the
 * image cannot be brought under the cap — never sends an oversized file.
 */
export async function prepareImageAttachment(path: string, mimeType: string): Promise<PreparedAttachment> {
  const size = statSync(path).size
  if (size <= INLINE_ATTACHMENT_LIMIT_BYTES) return { path, mimeType, downscaled: false }

  const sharp = await loadSharp()
  if (!sharp) {
    throw new Error(
      `attachment ${path}: ${size} bytes exceeds the ${INLINE_ATTACHMENT_LIMIT_BYTES}-byte inline limit and sharp is unavailable to downscale it — larger images silently degrade upstream (the model never sees the pixels).`,
    )
  }
  const outDir = mkdtempSync(join(tmpdir(), 'bakin-downscale-'))
  const outPath = join(outDir, 'attachment.jpg')
  await sharp(path)
    .rotate() // honor EXIF orientation before stripping metadata
    .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toFile(outPath)
  const outSize = statSync(outPath).size
  if (outSize > INLINE_ATTACHMENT_LIMIT_BYTES) {
    rmSync(outDir, { recursive: true, force: true })
    throw new Error(
      `attachment ${path}: still ${outSize} bytes after downscaling to ${MAX_DIMENSION}px — refusing to send (would silently degrade upstream).`,
    )
  }
  return { path: outPath, mimeType: 'image/jpeg', downscaled: true }
}

/**
 * Remove the temp dir a downscale created. Callers own the lifetime — e.g.
 * the enrichment engine calls this after its LAST send (the corrective
 * re-ask reuses the file). No-op for originals.
 */
export function cleanupPreparedAttachment(prepared: PreparedAttachment): void {
  if (!prepared.downscaled) return
  rmSync(dirname(prepared.path), { recursive: true, force: true })
}
