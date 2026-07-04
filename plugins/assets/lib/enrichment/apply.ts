/**
 * The ONLY writer of manifest.enrichment (spec D8 + Boundaries).
 *
 * Every write goes through the per-asset lock + atomic manifest write, so
 * enrichment results ride the exact chokepoints all manifest mutations use.
 * The rewrite re-enters the watcher's onSync → the search row refreshes and
 * `asset.changed` broadcasts for free.
 *
 * The manifest IS the durable enrichment record: `status: 'done'` +
 * `forVersion === currentVersion` means "nothing to do" (unless forced),
 * and `userEdited: true` locks fields against machine overwrites.
 */
import { withAssetLock } from '../asset-lock'
import { assetDirAbs } from '../asset-id'
import { readManifest, writeManifestAtomic, type AssetEnrichment, type AssetManifest } from '../manifest'

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * The asset vanished (trashed/deleted) between enqueue and write — a benign
 * lifecycle race, not a failure. The queue treats this as a skip.
 */
export class AssetGoneError extends Error {
  constructor(assetId: string) {
    super(`Asset gone: ${assetId}`)
    this.name = 'AssetGoneError'
  }
}

async function mutateEnrichment(
  assetId: string,
  mutate: (manifest: AssetManifest) => AssetEnrichment,
): Promise<AssetManifest> {
  return withAssetLock(assetId, async () => {
    const dirAbs = assetDirAbs(assetId)
    if (!dirAbs) throw new Error(`Invalid assetId: ${assetId}`)
    const manifest = readManifest(dirAbs)
    if (!manifest) throw new AssetGoneError(assetId)
    const next: AssetManifest = { ...manifest, enrichment: mutate(manifest), updated: nowIso() }
    writeManifestAtomic(dirAbs, next)
    return next
  })
}

/** Machine result for a specific version. Preserves user-edited fields. */
export async function applyEnrichmentResult(
  assetId: string,
  forVersion: number,
  model: string,
  fields: Pick<AssetEnrichment, 'caption' | 'ocrText' | 'suggestedTags' | 'summary' | 'transcript'>,
): Promise<AssetManifest> {
  return mutateEnrichment(assetId, (manifest) => {
    const previous = manifest.enrichment
    // A user's manual edits win over the machine, field-by-field: the
    // machine refreshes only what the user never touched.
    const content: Partial<AssetEnrichment> = previous?.userEdited
      ? { ...stripUndefined(fields), ...stripUndefined(previous) }
      : { ...previous, ...stripUndefined(fields) }
    return {
      ...content,
      status: 'done',
      model,
      at: nowIso(),
      forVersion,
      error: undefined,
      userEdited: previous?.userEdited,
    }
  })
}

export async function markEnrichmentPending(assetId: string): Promise<AssetManifest> {
  return mutateEnrichment(assetId, (manifest) => ({
    ...manifest.enrichment,
    status: 'pending',
    error: undefined,
  }))
}

export async function markEnrichmentFailed(assetId: string, error: string): Promise<AssetManifest> {
  return mutateEnrichment(assetId, (manifest) => ({
    ...manifest.enrichment,
    status: 'failed',
    error: error.slice(0, 500),
    at: nowIso(),
  }))
}

/** No capable provider/model for this asset type — recorded, not retried. */
export async function markEnrichmentSkipped(assetId: string, reason: string): Promise<AssetManifest> {
  return mutateEnrichment(assetId, (manifest) => ({
    ...manifest.enrichment,
    status: 'skipped',
    error: reason.slice(0, 500),
    at: nowIso(),
  }))
}

/** Manual edit from the detail UI — locks the record against overwrites. */
export async function applyUserEnrichmentEdit(
  assetId: string,
  fields: Partial<Pick<AssetEnrichment, 'caption' | 'ocrText' | 'suggestedTags' | 'summary' | 'transcript'>>,
): Promise<AssetManifest> {
  return mutateEnrichment(assetId, (manifest) => ({
    status: manifest.enrichment?.status ?? 'done',
    ...manifest.enrichment,
    ...stripUndefined(fields),
    userEdited: true,
    at: nowIso(),
  }))
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}
