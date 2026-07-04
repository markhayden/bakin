/**
 * Schedule plugin — client entry point.
 * Nav is declared in bakin-plugin.json `contributes.nav`; slots are mirrored
 * in `contributes.slots` so the host lazy-loads this client on first render.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { SchedulePage } from './components/schedule-page'

registerPlugin({
  id: 'schedule',
  search: {
    hitRenderers: {
      schedule: (hit) => ({
        title: String(hit.fields.name ?? hit.id),
        subtitle: [hit.fields.schedule, hit.fields.agent].filter(Boolean).join(' · ') || 'cron job',
        // Hit id is the raw job id (no prefix strip); the page opens the
        // job drawer from ?jobId=.
        href: `/schedule?jobId=${encodeURIComponent(hit.id)}`,
        icon: 'calendar',
      }),
    },
  },
  slots: {
    'page:/schedule': SchedulePage,
  },
})
