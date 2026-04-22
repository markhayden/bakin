/**
 * Assets plugin — client entry point.
 * Exports nav items for the plugin manifest and registers client-side slot
 * contributions (the built-in `asset-preview` renderer set).
 */
import type { NavItem } from '../../src/lib/plugin-types'
import { registerSlot } from '@bakin/sdk/slots'
import { AssetRenderer } from './components/asset-renderer'

export const navItems: NavItem[] = [
  { id: 'assets', label: 'Assets', icon: 'FolderOpen', href: '/assets', order: 20 },
]

// Built-in asset preview renderer. User plugins can register their own
// renderers (3D models, Figma, specialized formats) by calling
// `registerSlot('asset-preview', MyRenderer, order)` with a lower `order` to
// take priority — they're responsible for narrowing on `asset.type`
// themselves and falling through to the default when their match fails.
registerSlot('asset-preview', AssetRenderer)
