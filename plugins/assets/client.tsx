/**
 * Assets plugin — client entry point.
 * Exports nav items for the plugin manifest and registers client-side slot
 * contributions (the built-in `asset-preview` renderer set).
 */
import type { NavItem } from '../../src/lib/plugin-types'
import { registerSlot } from '@bakin/sdk/slots'
import { AssetRenderer } from './components/asset-renderer'
import { AssetDetailModal } from './components/asset-detail'
import { TaskAssets } from './components/task-assets'
import { AssetsPage } from './components/assets-page'

export const navItems: NavItem[] = [
  { id: 'assets', label: 'Assets', icon: 'FolderOpen', href: '/assets', order: 20 },
]

// Built-in asset preview renderer. User plugins can register their own
// renderers (3D models, Figma, specialized formats) by calling
// `registerSlot('asset-preview', MyRenderer, order)` with a lower `order` to
// take priority — they're responsible for narrowing on `asset.type`
// themselves and falling through to the default when their match fails.
registerSlot('asset-preview', AssetRenderer)

// Detail modal surface — consumed by projects + any plugin that embeds a
// filename click-to-preview affordance without wanting the full assets page.
registerSlot('asset-detail-modal', AssetDetailModal)

// Task-scoped asset gallery — consumed by tasks detail dialog. Shows all
// assets linked to a task plus an Add button. User plugins can override by
// registering their own `task-assets` slot with a lower `order`.
registerSlot('task-assets', TaskAssets)

// Top-level /assets page — rendered by the Next.js route wrapper via
// <Slot name="page:/assets" />. See src/app/assets/page.tsx.
registerSlot('page:/assets', AssetsPage)
