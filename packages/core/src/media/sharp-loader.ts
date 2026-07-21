/**
 * The ONE lazy sharp loader. sharp is an optional native dependency —
 * consumers (asset mutations, enrichment downscale, chat attachments,
 * image tools) degrade gracefully when it isn't installed. Module-level
 * cache so the import cost and the unavailable-warning fire once.
 */
import { createLogger } from '../logger'

const log = createLogger('media')

/**
 * The subset of the sharp API Bakin uses, typed STRUCTURALLY — a
 * `typeof` import of the sharp module here would put the sharp package
 * into the declaration graph of everything that can reach this file
 * (including the published SDK testing bundle since #703), and sharp
 * deliberately has no declared version anywhere. Extend this interface
 * when new call sites need more of sharp's surface.
 */
export interface SharpResizeOptions {
  width?: number
  height?: number
  fit?: 'inside' | 'cover' | 'contain' | 'fill' | 'outside'
  withoutEnlargement?: boolean
}

export interface SharpPipeline {
  rotate(): SharpPipeline
  resize(options: SharpResizeOptions): SharpPipeline
  resize(width?: number, height?: number, options?: SharpResizeOptions): SharpPipeline
  jpeg(options?: { quality?: number }): SharpPipeline
  png(options?: { quality?: number }): SharpPipeline
  webp(options?: { quality?: number }): SharpPipeline
  metadata(): Promise<{ width?: number; height?: number; format?: string }>
  toFile(path: string): Promise<unknown>
}

export type Sharp = (input: string) => SharpPipeline

let sharpModule: Promise<Sharp | null> | null = null

export async function loadSharp(): Promise<Sharp | null> {
  sharpModule ??= import('sharp')
    .then((mod): Sharp => (mod as unknown as { default?: Sharp }).default ?? (mod as unknown as Sharp))
    .catch((err) => {
      log.warn('sharp unavailable; image resize/metadata support disabled', {
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    })
  return sharpModule
}
