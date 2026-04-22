/**
 * Projects plugin — client entry point.
 */
import type { NavItem } from '../../src/lib/plugin-types'
import { registerSlot } from '@bakin/sdk/slots'
import { ProjectGrid } from './components/project-grid'
import { ProjectDetail } from './components/project-detail'

export const navItems: NavItem[] = [
  { id: 'projects', label: 'Projects', icon: 'Compass', href: '/projects', order: 30 },
]

registerSlot('page:/projects', ProjectGrid)
// ProjectDetail is the same component used for all 3 project detail views
// (new, view, edit) — the wrapper passes the routing-dependent props.
registerSlot('page:/projects/new', ProjectDetail)
registerSlot('page:/projects/[id]', ProjectDetail)
registerSlot('page:/projects/[id]/edit', ProjectDetail)
