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
          // Exact-record deep link: the page resolves ?recordId= via
          // GET /record and opens the detail drawer on the clicked row.
          // ?q= rides along so a resolution miss (row pruned from source)
          // still lands on the closest matches instead of a dead end.
          href: `/memory?recordId=${encodeURIComponent(hit.id)}&q=${encodeURIComponent(content.slice(0, 60))}`,
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
