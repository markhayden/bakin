/**
 * Image media helpers for the asset service: lazy `sharp` loading, image
 * dimension probing, and thumbnail generation (sharp, with an ffmpeg fallback).
 *
 * Extracted from asset-service.ts. This is the only module-level mutable state
 * in the asset service (the `sharpModule` promise cache), so isolating it keeps
 * the create/read/mutation paths free of side effects. `sharp` is loaded lazily
 * and tolerated-absent — image metadata/export degrade to null rather than
 * failing the asset operation.
 *
 * The sharp loader itself lives in @bakin/core/media/sharp-loader (ONE
 * module-level cache shared by assets, images, and chat attachments); this
 * module re-exports it so plugin-local consumers keep their import site.
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

import { loadSharp } from '@bakin/core/media/sharp-loader'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('asset-service')

export { loadSharp }

export async function imageDimensions(filePath: string): Promise<{ width: number | null; height: number | null }> {
  try {
    const sharp = await loadSharp()
    if (!sharp) return { width: null, height: null }
    const meta = await sharp(filePath).metadata()
    return { width: meta.width ?? null, height: meta.height ?? null }
  } catch {
    return { width: null, height: null }
  }
}

export async function generateThumbnail(inputPath: string, outputPath: string, widthPx = 400): Promise<boolean> {
  const sharp = await loadSharp()
  if (sharp) {
    try {
      await sharp(inputPath)
        .resize({ width: widthPx, withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toFile(outputPath)
      return existsSync(outputPath)
    } catch (err) {
      log.warn('sharp thumbnail generation failed; trying ffmpeg fallback', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  try {
    // argv form (no shell) — paths/extensions are derived from client filenames,
    // so a shell string would expand $(...)/backticks in a crafted name.
    const r = spawnSync(
      'ffmpeg',
      ['-i', inputPath, '-vf', `scale=${widthPx}:-1`, '-q:v', '5', '-y', outputPath],
      { stdio: 'pipe', timeout: 30_000 },
    )
    return r.status === 0 && existsSync(outputPath)
  } catch {
    return false
  }
}
