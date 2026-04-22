/**
 * Team plugin — client entry point.
 */
import type { NavItem } from '../../src/lib/plugin-types'
import { registerSlot } from '@bakin/sdk/slots'
import { TeamGrid } from './components/team-grid'
import { AgentDetail } from './components/agent-detail'

export const navItems: NavItem[] = [
  { id: 'team', label: 'Team', icon: 'Users', href: '/team', order: 60 },
]

registerSlot('page:/team', TeamGrid)
registerSlot('page:/team/[id]', AgentDetail)
