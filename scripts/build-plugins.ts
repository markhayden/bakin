/**
 * Build every core plugin — iterates CORE_PLUGINS and delegates each id to
 * buildOnePlugin. The helper handles the subprocess-spawn mechanics; this
 * script owns the list of plugins and the externals list.
 *
 * Server entries use --target=bun and --packages=external so node_modules
 * deps (chokidar, zod, js-yaml, search SDKs, etc.) stay out of the plugin
 * bundle. The host process already has them installed; native Bun modules
 * are resolved at runtime by Bun itself.
 *
 * Client entries use --target=browser. Only react + SDK package aliases are
 * externalized — other client deps (lucide-react, zustand, shadcn
 * primitives) bundle into client.js so the plugin is self-contained
 * from the browser's point of view.
 */
import { buildOnePlugin } from './dev-build-one-plugin'
import { PLUGIN_CLIENT_EXTERNALS } from '../src/core/whiskit/externals'

const CORE_PLUGINS = [
  'tasks', 'team', 'memory', 'models',
  'assets', 'images', 'workflows', 'schedule',
  'health', 'git',
]

// Single source for the externals contract — see src/core/whiskit/externals.ts.
const EXTERNAL = PLUGIN_CLIENT_EXTERNALS

for (const id of CORE_PLUGINS) {
  const result = await buildOnePlugin(id, { external: EXTERNAL, production: true })
  if (!result.ok) {
    console.error(`Failed to build ${result.stderr}`)
    process.exit(1)
  }
  console.log(`  built plugins/${id}/dist/`)
}

console.log(`plugins/<id>/dist: ${CORE_PLUGINS.length} plugins built`)

export {}
