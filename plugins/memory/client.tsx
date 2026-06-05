/**
 * Memory plugin — client entry point.
 * Nav is declared in bakin-plugin.json `contributes.nav`; slots are mirrored
 * in `contributes.slots` so the host lazy-loads this client on first render.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { MemoryShell } from './components/memory-shell'

registerPlugin({
  id: 'memory',
  slots: {
    'page:/memory': MemoryShell,
  },
})
