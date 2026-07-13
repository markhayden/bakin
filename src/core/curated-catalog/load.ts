/**
 * Unified curated-catalog loader.
 *
 * Resolution order favors FRESHNESS, matching the old /api/curated handler's
 * deliberate request-time disk read:
 *   1. the embedded-assets copy on disk (dev: the real source file, so edits
 *      show up without a server restart; binary: the compiler-embedded copy)
 *   2. the statically imported module snapshot (fallback when the embedded
 *      manifest is unavailable, e.g. unit tests)
 *
 * Failures NEVER silently produce an empty storefront without a trace: every
 * degradation logs loudly. The shipped file itself is CI-gated by
 * tests/core/curated-catalog.test.ts.
 */
import { readFileSync } from 'fs'
import curatedCatalogJson from '../../../packages/host/src/data/curated-catalog.json'
import { EMBEDDED_ASSETS } from '../../../packages/host/src/api/_embedded-assets'
import { createLogger } from '../logger'
import { CatalogFileSchema, type CatalogFile } from './schema'

// Lazy logger: resolved on first use, not at module load, so test-suite
// logger mocks (which apply after import hoisting) can intercept.
let logInstance: ReturnType<typeof createLogger> | null = null
function log(): ReturnType<typeof createLogger> {
  logInstance ??= createLogger('curated-catalog')
  return logInstance
}

export const CURATED_CATALOG_EMBEDDED_PATH = '/data/curated-catalog.json'

const EMPTY_CATALOG: CatalogFile = { version: 2, updatedAt: 'unknown', entries: [] }

function describeIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
}

/**
 * Normalize the static JSON import. Bun caches modules by PATH, not by
 * import attributes: when `_embedded-assets-static.ts` (evaluated first in
 * server.ts) imports this same file `with { type: 'file' }`, our plain JSON
 * import resolves to that cached module — a file-path STRING, not parsed
 * JSON — and every source-run server silently degraded the static catalog
 * to empty. Detect the string form and read/parse the file ourselves (works
 * identically for the compiled binary's embedded $bunfs path). Pinned by
 * tests/core/curated-catalog-import-collision.test.ts.
 */
function shippedCatalogRaw(): unknown {
  if (typeof curatedCatalogJson !== 'string') return curatedCatalogJson
  try {
    return JSON.parse(readFileSync(curatedCatalogJson, 'utf-8')) as unknown
  } catch (err) {
    log().error('failed to read shipped catalog through file-typed module', err instanceof Error ? err : undefined)
    return null
  }
}

/**
 * Synchronous parse of the statically imported shipped catalog. Never throws:
 * module-load consumers (RECOMMENDED_AGENTS/RECOMMENDED_PLUGINS) must not
 * crash server startup or the CLI on a bad catalog edit — they degrade to an
 * empty list with a loud log, and CI pins validity of the shipped file.
 */
export function staticCuratedCatalog(): CatalogFile {
  const parsed = CatalogFileSchema.safeParse(shippedCatalogRaw())
  if (!parsed.success) {
    log().error('shipped curated-catalog.json failed schema validation — catalog degraded to empty', undefined, {
      issues: describeIssues(parsed.error),
    })
    return EMPTY_CATALOG
  }
  return parsed.data
}

/**
 * Resolve a catalog from the embedded on-disk copy, falling back to an
 * arbitrary static JSON value. Exported for tests; app code uses
 * loadUnifiedCatalog.
 */
export async function loadCatalogFile(staticCatalogJson: unknown): Promise<CatalogFile> {
  const embedded = EMBEDDED_ASSETS.get(CURATED_CATALOG_EMBEDDED_PATH)
  if (embedded) {
    try {
      const file = Bun.file(embedded)
      if (await file.exists()) {
        const parsed = CatalogFileSchema.safeParse(JSON.parse(await file.text()))
        if (parsed.success) return parsed.data
        log().error('embedded curated catalog failed schema validation — falling back to static import', undefined, {
          path: embedded,
          issues: describeIssues(parsed.error),
        })
      } else {
        log().error('embedded curated catalog path does not exist — falling back to static import', undefined, {
          path: embedded,
        })
      }
    } catch (err) {
      log().error('failed to read embedded curated catalog — falling back to static import', err instanceof Error ? err : undefined, {
        path: embedded,
      })
    }
  }

  const staticParsed = CatalogFileSchema.safeParse(staticCatalogJson)
  if (!staticParsed.success) {
    log().error('static curated catalog failed schema validation — catalog degraded to empty', undefined, {
      issues: describeIssues(staticParsed.error),
    })
    return EMPTY_CATALOG
  }
  return staticParsed.data
}

export async function loadUnifiedCatalog(): Promise<CatalogFile> {
  return loadCatalogFile(shippedCatalogRaw())
}
