/**
 * Assets plugin — client entry point.
 * Registers nav items and client-side slot contributions via registerPlugin.
 */
import { registerPlugin } from '@makinbakin/sdk'
import type { NavItem } from '@makinbakin/sdk'
import { AssetRenderer } from './components/asset-renderer'
import { AssetDetailModal } from './components/asset-detail'
import { TaskAssets } from './components/task-assets'
import { VersionedAssetGrid } from './components/versioned/VersionedAssetGrid'
import { VersionedAssetDetail } from './components/versioned/VersionedAssetDetail'

const navItems: NavItem[] = [
  { id: 'assets', label: 'Assets', icon: 'FolderOpen', href: '/assets', order: 20 },
]

registerPlugin({
  id: 'assets',
  navItems,
  slots: {
    // Built-in asset preview renderer. User plugins can register their own
    // renderers (3D models, Figma, specialized formats) by calling
    // registerSlot('asset-preview', MyRenderer, order) with a lower `order`
    // to take priority — they're responsible for narrowing on `asset.type`
    // themselves and falling through to the default when their match fails.
    'asset-preview': AssetRenderer,
    // Detail modal surface — consumed by projects + any plugin that embeds a
    // filename click-to-preview affordance without wanting the full assets
    // page.
    'asset-detail-modal': AssetDetailModal,
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
