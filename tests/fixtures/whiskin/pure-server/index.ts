// Minimal server-only fixture plugin. Uses a local interface (not the SDK
// BakinPlugin type) to stay decoupled from SDK internals, matching the
// sample-user-plugin fixture pattern. Built by the Whiskin server build path.
interface PluginLike {
  id: string
  name: string
  version: string
  activate: () => void
}

const plugin: PluginLike = {
  id: 'whiskin-pure-server',
  name: 'Whiskin Pure Server',
  version: '0.1.0',
  activate() {
    // No-op: exists to exercise the server-only build path.
  },
}

export default plugin
