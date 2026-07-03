/**
 * Team plugin — client entry point.
 * Nav is declared in bakin-plugin.json `contributes.nav`; slots are mirrored
 * in `contributes.slots` so the host lazy-loads this client on first render.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { TeamGrid } from './components/team-grid'
import { AgentDetail } from './components/agent-detail'
import { TeamDetail } from './components/team-detail'

registerPlugin({
  search: {
    hitRenderers: {
      agents: (hit) => ({
        title: String(hit.fields.name ?? hit.id),
        subtitle: String(hit.fields.role ?? 'agent'),
        href: `/team/${encodeURIComponent(hit.id)}`,
        thumbnailUrl: `/api/agents/${encodeURIComponent(hit.id)}/avatar`,
        icon: 'users',
      }),
      'agent-lessons': (hit) => {
        const agent = typeof hit.fields.agent === 'string' ? hit.fields.agent : ''
        return {
          title: String(hit.fields.title ?? hit.fields.summary ?? hit.id).slice(0, 120),
          subtitle: agent ? `lesson · ${agent}` : 'lesson',
          href: agent ? `/team/${encodeURIComponent(agent)}` : null,
          icon: 'graduation-cap',
        }
      },
    },
  },
  id: 'team',
  slots: {
    'page:/team': TeamGrid,
    'page:/team/[id]': AgentDetail,
    'page:/team/teams/[teamId]': TeamDetail,
  },
})
