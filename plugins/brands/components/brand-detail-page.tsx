/**
 * /brands/$brandId slot wrapper — reads the brand id from the route params
 * (assets.$assetId pattern) and renders the detail surface. Back navigates to
 * the list route; the detail's tab state stays in `?tab=`.
 */
import { useHistoryBack, useParams } from '@makinbakin/sdk/navigation'
import { BrandDetail } from './brand-detail'

export function BrandDetailPage() {
  const { brandId } = useParams<{ brandId: string }>()
  // Same pattern as the asset viewer: back = where you came from, list on a
  // cold deep-link. (Deletion navigates to the list explicitly inside
  // BrandDetail — history-back to a deleted brand would strand you.)
  const goBack = useHistoryBack('/brands')
  // key: same-route param navigation (search hit A → search hit B) reuses the
  // mounted component — without a remount, brand A's staged draft/detail state
  // would survive under brand B's URL and Save would cross-write manifests.
  return <BrandDetail key={brandId} brandId={brandId} onBack={goBack} />
}
