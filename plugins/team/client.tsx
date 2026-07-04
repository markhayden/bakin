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
      // Keyed by bare table name — the overlay resolves renderers via
      // renderers.get(table minus the bakin_ prefix), and the table is `team`.
      team: (hit) => ({
        title: String(hit.fields.name ?? hit.id),
        subtitle: String(hit.fields.role ?? 'agent'),
        href: `/team/${encodeURIComponent(hit.id)}`,
        thumbnailUrl: `/api/agents/${encodeURIComponent(hit.id)}/avatar`,
        icon: 'users',
      }),
      'agent-lessons': (hit) => {
        // Schema fields are agent_id/lesson_id (plugins/team/index.ts).
        const agentId = typeof hit.fields.agent_id === 'string' ? hit.fields.agent_id : ''
        const lessonId = typeof hit.fields.lesson_id === 'string' ? hit.fields.lesson_id : ''
        const href = agentId
          ? `/team/${encodeURIComponent(agentId)}?tab=lessons${lessonId ? `&lessonId=${encodeURIComponent(lessonId)}` : ''}`
          : null
        return {
          title: String(hit.fields.title ?? hit.fields.summary ?? hit.id).slice(0, 120),
          subtitle: agentId ? `lesson · ${agentId}` : 'lesson',
          href,
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
