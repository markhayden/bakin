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

registerPlugin({
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
  },
})
