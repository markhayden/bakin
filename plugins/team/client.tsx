/**
 * Team plugin — client entry point.
 * Nav is declared in bakin-plugin.json `contributes.nav`; slots are mirrored
 * in `contributes.slots` so the host lazy-loads this client on first render.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { TeamGrid } from './components/team-grid'
import { AgentDetail } from './components/agent-detail'

registerPlugin({
  id: 'team',
  slots: {
    'page:/team': TeamGrid,
    'page:/team/[id]': AgentDetail,
  },
})
