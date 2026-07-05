/**
 * Unified curated-catalog loader.
 *
 * Resolution mirrors the old onboarding loadCuratedCatalog helper it
 * replaces: the statically imported JSON wins when it has entries (dev +
 * test path — the import is a normal ESM module), otherwise the embedded
 * copy is read from disk (compiled binary path), falling back to the
 * static object.
 */
import curatedCatalogJson from '../../../packages/host/src/data/curated-catalog.json'
import { EMBEDDED_ASSETS } from '../../../packages/host/src/api/_embedded-assets'
import { CatalogFileSchema, type CatalogFile } from './schema'

export const CURATED_CATALOG_EMBEDDED_PATH = '/data/curated-catalog.json'

const EMPTY_CATALOG: CatalogFile = { version: 2, updatedAt: 'unknown', entries: [] }

/** Synchronous parse of the statically imported shipped catalog. */
export function staticCuratedCatalog(): CatalogFile {
  return CatalogFileSchema.parse(curatedCatalogJson)
}

/**
 * Resolve a catalog from an arbitrary static JSON value, falling back to
 * the embedded copy. Exported for tests; app code uses loadUnifiedCatalog.
 */
export async function loadCatalogFile(staticCatalogJson: unknown): Promise<CatalogFile> {
  const staticParsed = CatalogFileSchema.safeParse(staticCatalogJson)
  if (staticParsed.success && staticParsed.data.entries.length > 0) return staticParsed.data

  const embedded = EMBEDDED_ASSETS.get(CURATED_CATALOG_EMBEDDED_PATH)
  if (embedded) {
    try {
      const file = Bun.file(embedded)
      if (await file.exists()) {
        const parsed = CatalogFileSchema.safeParse(JSON.parse(await file.text()))
        if (parsed.success) return parsed.data
      }
    } catch {
      // Fall back to the statically imported catalog below.
    }
  }

  return staticParsed.success ? staticParsed.data : EMPTY_CATALOG
}

export async function loadUnifiedCatalog(): Promise<CatalogFile> {
  return loadCatalogFile(curatedCatalogJson)
}
