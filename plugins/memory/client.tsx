/**
 * Memory plugin — client entry point.
 */
import { registerPlugin } from '@makinbakin/sdk'
import type { NavItem } from '@makinbakin/sdk'
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
