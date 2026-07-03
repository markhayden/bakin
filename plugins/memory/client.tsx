/**
 * Memory plugin — client entry point.
 * Nav is declared in bakin-plugin.json `contributes.nav`; slots are mirrored
 * in `contributes.slots` so the host lazy-loads this client on first render.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { MemoryShell } from './components/memory-shell'

registerPlugin({
  search: {
    hitRenderers: {
      memory: (hit) => {
        const content = String(hit.fields.content ?? hit.fields.summary ?? hit.id)
        const agent = typeof hit.fields.agent === 'string' ? hit.fields.agent : ''
        return {
          title: content.slice(0, 120),
          subtitle: [hit.fields.tier, agent].filter(Boolean).join(' · ') || 'memory',
          href: `/memory?q=${encodeURIComponent(content.slice(0, 60))}${agent ? `&agent=${encodeURIComponent(agent)}` : ''}`,
          icon: 'brain',
        }
      },
    },
  },
  id: 'memory',
  slots: {
    'page:/memory': MemoryShell,
  },
})
