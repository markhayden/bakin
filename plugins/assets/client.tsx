/**
 * Assets plugin — client entry point.
 * Registers client-side slot contributions via registerPlugin. Nav is
 * declared in bakin-plugin.json `contributes.nav`; slots are mirrored in
 * `contributes.slots` so the host lazy-loads this client on first render
 * of any of them.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { TaskAssets } from './components/task-assets'
import { VersionedAssetGrid } from './components/versioned/VersionedAssetGrid'
import { VersionedAssetDetail } from './components/versioned/VersionedAssetDetail'
import { AssetsBadgeProvider } from './components/assets-badge-provider'

registerPlugin({
  search: {
    hitRenderers: {
      assets: (hit) => {
        // First NON-EMPTY wins — un-enriched assets carry caption: '' and
        // nullish-coalescing would keep the empty string as the title.
        const pick = (...vals: unknown[]) => vals.map((v) => String(v ?? '').trim()).find((v) => v.length > 0)
        const type = pick(hit.fields.asset_type) ?? 'asset'
        const iconByType: Record<string, string> = { image: 'image', images: 'image', text: 'file-text', audio: 'music', video: 'video', pdf: 'file-text' }
        // Thumbnails only exist for media with a media_url (raster/audio);
        // text/other assets get a type icon instead of a broken <img>.
        const hasThumb = pick(hit.fields.media_url) !== undefined
        const dateRaw = pick(hit.fields.updated_at)
        const date = dateRaw ? new Date(dateRaw).toLocaleDateString() : undefined
        const title = pick(hit.fields.caption, hit.fields.description, hit.fields.tags, hit.fields.file_name) ?? hit.id
        // Subtitle: the best non-empty text that ISN'T already the title.
        const subtitle = [hit.fields.description, hit.fields.tags, hit.fields.ocr_text]
          .map((v) => String(v ?? '').trim())
          .find((v) => v.length > 0 && v !== title)
        return {
          title,
          subtitle,
          meta: [type, pick(hit.fields.agent), date].filter(Boolean).join(' · '),
          href: `/assets/${hit.id}`,
          ...(hasThumb ? { thumbnailUrl: `/api/assets/${hit.id}/thumb` } : {}),
          icon: iconByType[type] ?? 'file',
        }
      },
    },
  },
  id: 'assets',
  slots: {
    // Task-scoped asset gallery — consumed by tasks detail dialog. Shows all
    // assets linked to a task plus an Add button. User plugins can override
    // by registering their own `task-assets` slot with a lower `order`.
    'task-assets': TaskAssets,
    // Top-level /assets page — the versioned grid (one card per asset, version
    // badge), rendered via <Slot name="page:/assets" /> in routes/assets.tsx.
    'page:/assets': VersionedAssetGrid,
    // Versioned-asset detail route — timeline + exports + promote/delete,
    // rendered via <Slot name="page:/assets/:assetId" /> in routes/assets.$assetId.tsx.
    'page:/assets/:assetId': VersionedAssetDetail,
    // Background badge: unmanaged-file count on the Assets nav item (D7) —
    // driven by the asset.unmanaged SSE event, no fetch on mount.
    'nav-badge-providers': AssetsBadgeProvider,
  },
})
