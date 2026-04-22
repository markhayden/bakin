/**
 * Projects plugin — client entry point.
 */
import type { NavItem } from '../../src/lib/plugin-types'
import { registerSlot } from '@bakin/sdk/slots'
import { ProjectGrid } from './components/project-grid'

export const navItems: NavItem[] = [
  { id: 'projects', label: 'Projects', icon: 'Compass', href: '/projects', order: 30 },
]

registerSlot('page:/projects', ProjectGrid)
