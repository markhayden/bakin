/**
 * The ONE lazy sharp loader. sharp is an optional native dependency —
 * consumers (asset mutations, enrichment downscale, chat attachments,
 * image tools) degrade gracefully when it isn't installed. Module-level
 * cache so the import cost and the unavailable-warning fire once.
 */
import { createLogger } from '../logger'

const log = createLogger('media')

export type Sharp = typeof import('sharp')

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
