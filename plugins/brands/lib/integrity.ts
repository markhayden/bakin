/**
 * Brand integrity scan (#419, spec §10) — the SINGLE implementation behind
 * both `GET /:brandId/integrity` (detail-page warnings) and the
 * brands.integrity doctor check (T7.1). Findings are structured data; no
 * consumer ever parses message text.
 */
import { listBrands, getBrand } from './store'
import type { BrandManifest } from './schemas'

export interface DanglingRef {
  assetId: string
  where: string
}

export interface BrandIntegrityFinding {
  brandId: string
  dangling: DanglingRef[]
  draft: boolean
  /** Draft created >7d ago and never published — probably forgotten. */
  staleDraft: boolean
}

export interface BrandIntegrityReport {
  findings: BrandIntegrityFinding[]
  invalid: Array<{ id: string; error: string }>
}

const STALE_DRAFT_MS = 7 * 24 * 60 * 60 * 1000

function collectRefs(manifest: BrandManifest): Map<string, string> {
  const refs = new Map<string, string>()
  for (const logo of manifest.logos) refs.set(logo.assetId, `logo (${logo.variant})`)
  for (const group of manifest.assetGroups) {
    for (const id of group.assetIds) if (!refs.has(id)) refs.set(id, `group ${group.name}`)
  }
  for (const id of manifest.defaultImageReferences ?? []) {
    if (!refs.has(id)) refs.set(id, 'defaultImageReferences')
  }
  return refs
}

export interface BrandAssetReference {
  brandId: string
  where: string
}

/**
 * The usage fact behind the `brands.assetReferences` hook: every brand (with
 * a readable manifest) that references each asset id, and where. A brand
 * whose manifest is unreadable cannot be scanned and is not counted.
 */
export function brandsReferencingAssets(assetIds: readonly string[]): Record<string, BrandAssetReference[]> {
  const wanted = new Set(assetIds)
  const byAsset: Record<string, BrandAssetReference[]> = {}
  for (const manifest of listBrands().brands) {
    for (const [assetId, where] of collectRefs(manifest)) {
      if (!wanted.has(assetId)) continue
      ;(byAsset[assetId] ??= []).push({ brandId: manifest.id, where })
    }
  }
  return byAsset
}

/**
 * Drop the named asset ids from every place ONE brand references them —
 * unconditionally. This is the operator's explicit detach (the asset recover
 * page's "Detach references", the `brands.detachAsset` hook); the dangling
 * path below adds the liveness check in front of it.
 */
export async function detachAssetRefs(
  brandId: string,
  assetIds: readonly string[],
): Promise<{ brand: BrandManifest; detached: string[] }> {
  const { updateBrand } = await import('./store')
  const wanted = [...new Set(assetIds)]
  const gone = new Set(wanted)
  const brand = await updateBrand(brandId, (manifest) => ({
    ...manifest,
    logos: manifest.logos.filter((logo) => !gone.has(logo.assetId)),
    assetGroups: manifest.assetGroups.map((group) => ({ ...group, assetIds: group.assetIds.filter((id) => !gone.has(id)) })),
    ...(manifest.defaultImageReferences ? { defaultImageReferences: manifest.defaultImageReferences.filter((id) => !gone.has(id)) } : {}),
  }))
  return { brand, detached: wanted }
}

/** Detach ONE asset from every brand that references it (spec §3.9 — the asset's own recover page). */
export async function detachAssetFromAllBrands(assetId: string): Promise<{ detached: string[] }> {
  const referencing = brandsReferencingAssets([assetId])[assetId] ?? []
  const brandIds = [...new Set(referencing.map((ref) => ref.brandId))]
  for (const brandId of brandIds) await detachAssetRefs(brandId, [assetId])
  return { detached: brandIds }
}

/**
 * The operator's "Detach" (self-healing 1.4a, row 189): drop the named asset
 * ids from every place the brand references them. Refuses an id that still
 * resolves to an asset — detaching a live reference is an edit, not a repair.
 */
export async function detachDanglingRefs(
  brandId: string,
  assetIds: readonly string[],
  assetExists: (assetId: string) => Promise<boolean>,
): Promise<{ brand: BrandManifest; detached: string[] }> {
  const wanted = [...new Set(assetIds)]
  for (const assetId of wanted) {
    if (await assetExists(assetId)) throw new Error(`${assetId} still resolves to an asset — it is a live reference, not a dangling one.`)
  }
  return detachAssetRefs(brandId, wanted)
}

export async function scanBrandIntegrity(
  assetExists: (assetId: string) => Promise<boolean>,
  brandId?: string,
): Promise<BrandIntegrityReport> {
  const { brands, invalid } = brandId
    ? (() => {
        const read = getBrand(brandId)
        return read.status === 'ok'
          ? { brands: [read.manifest], invalid: [] as Array<{ id: string; error: string }> }
          : { brands: [], invalid: read.status === 'invalid' ? [{ id: brandId, error: read.error }] : [] }
      })()
    : listBrands()

  const findings: BrandIntegrityFinding[] = []
  for (const manifest of brands) {
    const dangling: DanglingRef[] = []
    for (const [assetId, where] of collectRefs(manifest)) {
      try {
        if (!(await assetExists(assetId))) dangling.push({ assetId, where })
      } catch {
        // Existence check unavailable — report nothing rather than guess.
      }
    }
    const createdMs = Date.parse(manifest.createdAt)
    findings.push({
      brandId: manifest.id,
      dangling,
      draft: !!manifest.draft,
      staleDraft: !!manifest.draft && Number.isFinite(createdMs) && Date.now() - createdMs > STALE_DRAFT_MS,
    })
  }
  return { findings, invalid }
}
