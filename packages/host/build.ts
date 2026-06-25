/**
 * Bakin host client bundle.
 *
 * Builds packages/host/src/main.tsx → packages/host/dist/main.mjs for the
 * browser. Externals (React, SDK package aliases) are wired in via the import map
 * emitted by `packages/host/public/index.html`, pointing at vendor bundles
 * under `/vendor/*.js`. Plugin client bundles are loaded dynamically at
 * runtime by `PluginHost`, so the shell no longer statically imports any
 * plugin and we use the [ext] token so CSS and JS land at distinct paths
 * without colliding on '.mjs'.
 */
import { rmSync } from 'node:fs'

import { PLUGIN_CLIENT_EXTERNALS } from '../../src/core/whiskit/externals'

const production = process.env.BAKIN_DEV !== '1'

// Always start from a clean dist so stale TC1 outputs don't linger.
rmSync('./packages/host/dist', { recursive: true, force: true })

await Bun.build({
  entrypoints: ['./packages/host/src/main.tsx'],
  outdir: './packages/host/dist',
  target: 'browser',
  format: 'esm',
  sourcemap: production ? 'none' : 'external',
  minify: production,
  define: {
    'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
  },
  naming: {
    entry: '[name].[ext]',
    chunk: '[name]-[hash].[ext]',
    asset: '[name]-[hash].[ext]',
  },
  // TD1: externalize React + SDK package aliases so plugins and shell share instances
  // at runtime via the browser import map emitted in TD3. TD2 produces the
  // vendor bundles that the import map points at. Single source for the contract —
  // see src/core/whiskit/externals.ts (matches the plugin client bundles exactly).
  external: [...PLUGIN_CLIENT_EXTERNALS],
})

console.log('packages/host: built')

export {}
