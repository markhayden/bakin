import { EMBEDDED_ASSETS } from '../../../packages/host/src/api/_embedded-assets'

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function hasRows(catalog: Record<string, unknown>, key: string): boolean {
  const rows = catalog[key]
  return Array.isArray(rows) && rows.length > 0
}

export async function loadCuratedCatalog<T extends Record<string, unknown>>(
  staticCatalog: unknown,
  embeddedPath: string,
  rowKey: string,
): Promise<T> {
  const staticObject = asObject(staticCatalog)
  if (staticObject && hasRows(staticObject, rowKey)) return staticObject as T

  const embedded = EMBEDDED_ASSETS.get(embeddedPath)
  if (embedded) {
    try {
      const file = Bun.file(embedded)
      if (await file.exists()) {
        const parsed = asObject(JSON.parse(await file.text()))
        if (parsed) return parsed as T
      }
    } catch {
      // Fall back to the statically imported catalog below.
    }
  }

  return (staticObject ?? {}) as T
}
