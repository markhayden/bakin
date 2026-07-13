/**
 * /brands/$brandId slot wrapper — reads the brand id from the route params
 * (assets.$assetId pattern) and renders the detail surface. Back navigates to
 * the list route; the detail's tab state stays in `?tab=`.
 */
import { useNavigate, useParams } from '@tanstack/react-router'
import { BrandDetail } from './brand-detail'

export function BrandDetailPage() {
  const { brandId } = useParams({ strict: false }) as { brandId: string }
  const navigate = useNavigate()
  // key: same-route param navigation (search hit A → search hit B) reuses the
  // mounted component — without a remount, brand A's staged draft/detail state
  // would survive under brand B's URL and Save would cross-write manifests.
  return <BrandDetail key={brandId} brandId={brandId} onBack={() => void navigate({ to: '/brands' })} />
}
