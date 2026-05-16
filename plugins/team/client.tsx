/**
 * Team plugin — client entry point.
 */
import { registerPlugin } from '@makinbakin/sdk'
import type { NavItem } from '@makinbakin/sdk'
import { TeamGrid } from './components/team-grid'
import { AgentDetail } from './components/agent-detail'

const navItems: NavItem[] = [
  { id: 'team', label: 'Team', icon: 'Users', href: '/team', order: 60 },
]

registerPlugin({
  id: 'team',
  navItems,
  slots: {
    'page:/team': TeamGrid,
    'page:/team/[id]': AgentDetail,
  },
})
