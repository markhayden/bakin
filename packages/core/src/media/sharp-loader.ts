/**
 * The ONE lazy sharp loader. Two legs, in order (#889):
 *
 *  1. `import('sharp')` — dev trees / npm installs, where node_modules
 *     carries the native prebuilds. Compiled binaries CANNOT bundle those
 *     (sharp is a compile external), so this leg fails there by design.
 *  2. The media store — `bakin install media` / onboarding / doctor repair
 *     places a self-contained bundle + natives under ~/.bakin/media/
 *     (see ./installer.ts); the loader imports it from disk.
 *
 * Module-level cache so the import cost and the unavailable-warning fire
 * once — but a cached FAILURE re-probes when a store receipt appears, so an
 * install fixes a running server without a restart.
 */
import { createLogger } from '../logger'
import { importBundledSharp, importStoreBundle } from './sharp-import'
import { mediaStoreEntry } from './store'

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
/** Store entry the cached FAILURE already tried (null = none existed then). */
let failedWithStoreEntry: string | null = null

/**
 * Drop the cached load state. The installer calls this after a successful
 * store install; tests use it between cases.
 */
export function resetSharpModuleCache(): void {
  sharpModule = null
  failedWithStoreEntry = null
}

const asSharp = (mod: unknown): Sharp =>
  (mod as { default?: Sharp }).default ?? (mod as Sharp)

export async function loadSharp(): Promise<Sharp | null> {
  if (sharpModule) {
    const cached = await sharpModule
    // Success caches forever. A failure re-probes when a store entry exists
    // that the failed attempt never saw (e.g. `bakin install media` ran in
    // another process while this server was up).
    if (cached) return cached
    const entry = mediaStoreEntry()
    if (!entry || entry === failedWithStoreEntry) return cached
    sharpModule = null
  }

  sharpModule = (async (): Promise<Sharp | null> => {
    let bundledError: unknown
    try {
      return asSharp(await importBundledSharp())
    } catch (err) {
      bundledError = err
    }

    const entry = mediaStoreEntry()
    failedWithStoreEntry = entry
    if (entry) {
      try {
        const loaded = asSharp(await importStoreBundle(entry))
        log.info('sharp loaded from the media store', { entry })
        return loaded
      } catch (err) {
        log.warn('media store sharp bundle failed to load; image resize/metadata support disabled — run `bakin install media` to repair', {
          entry,
          error: err instanceof Error ? err.message : String(err),
        })
        return null
      }
    }

    log.warn('sharp unavailable; image resize/metadata support disabled — run `bakin install media` (or Health → repair) to install the media store', {
      error: bundledError instanceof Error ? bundledError.message : String(bundledError),
    })
    return null
  })()
  return sharpModule
}
