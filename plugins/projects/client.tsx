/**
 * Projects plugin — client entry point.
 */
import { registerPlugin } from '@bakin/sdk'
import type { NavItem } from '@bakin/sdk'
import { ProjectGrid } from './components/project-grid'
import { ProjectDetail } from './components/project-detail'

const navItems: NavItem[] = [
  { id: 'projects', label: 'Projects', icon: 'Compass', href: '/projects', order: 30 },
]

registerPlugin({
  id: 'projects',
  navItems,
  slots: {
    'page:/projects': ProjectGrid,
    // ProjectDetail is the same component used for all 3 project detail views
    // (new, view, edit) — the wrapper passes the routing-dependent props.
    'page:/projects/new': ProjectDetail,
    'page:/projects/[id]': ProjectDetail,
    'page:/projects/[id]/edit': ProjectDetail,
  },
})
