/**
 * Memory plugin — client entry point.
 */
import type { NavItem } from '../../src/lib/plugin-types'
import { registerSlot } from '@bakin/sdk/slots'
import { MemoryShell } from './components/memory-shell'

export const navItems: NavItem[] = [
  { id: 'memory', label: 'Memory', icon: 'Brain', href: '/memory', order: 50 },
]

registerSlot('page:/memory', MemoryShell)
