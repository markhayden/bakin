/**
 * Memory plugin — client entry point.
 */
import { registerPlugin } from '@bakin/sdk'
import type { NavItem } from '@bakin/sdk'
import { MemoryShell } from './components/memory-shell'

const navItems: NavItem[] = [
  { id: 'memory', label: 'Memory', icon: 'Brain', href: '/memory', order: 50 },
]

registerPlugin({
  id: 'memory',
  navItems,
  slots: {
    'page:/memory': MemoryShell,
  },
})
