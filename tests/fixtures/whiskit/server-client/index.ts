// Minimal server entry paired with a client.tsx (exercises both build paths).
interface PluginLike {
  id: string
  name: string
  version: string
  activate: () => void
}

const plugin: PluginLike = {
  id: 'whiskit-server-client',
  name: 'Whiskit Server + Client',
  version: '0.1.0',
  activate() {
    // No-op: exists to exercise the server build alongside a client.
  },
}

export default plugin
