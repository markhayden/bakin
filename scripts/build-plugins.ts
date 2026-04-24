/**
 * Build every core plugin — iterates CORE_PLUGINS and delegates each id to
 * buildOnePlugin. The helper handles the subprocess-spawn mechanics; this
 * script owns the list of plugins and the externals list.
 *
 * Server entries use --target=bun and --packages=external so node_modules
 * deps (chokidar, zod, js-yaml, @antfly/sdk, etc.) stay out of the plugin
 * bundle. The host process already has them installed; bun:sqlite is
 * resolved at runtime by Bun itself.
 *
 * Client entries use --target=browser. Only react + @bakin/sdk/* are
 * externalized — other client deps (lucide-react, zustand, shadcn
 * primitives) bundle into client.js so the plugin is self-contained
 * from the browser's point of view.
 */
import { buildOnePlugin } from './dev-build-one-plugin'

const CORE_PLUGINS = [
  'tasks', 'team', 'workflows', 'projects', 'assets',
  'schedule', 'memory', 'messaging', 'models', 'health',
]

const EXTERNAL = [
  'react', 'react-dom', 'react-dom/client',
  'react/jsx-runtime', 'react/jsx-dev-runtime',
  '@tanstack/react-router',
  '@bakin/sdk', '@bakin/sdk/ui', '@bakin/sdk/hooks',
  '@bakin/sdk/components', '@bakin/sdk/slots',
  '@bakin/sdk/types', '@bakin/sdk/utils',
]

for (const id of CORE_PLUGINS) {
  const result = await buildOnePlugin(id, { external: EXTERNAL })
  if (!result.ok) {
    console.error(`Failed to build ${result.stderr}`)
    process.exit(1)
  }
  console.log(`  built plugins/${id}/dist/`)
}

console.log(`plugins/<id>/dist: ${CORE_PLUGINS.length} plugins built`)

export {}
