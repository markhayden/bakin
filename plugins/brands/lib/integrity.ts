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
