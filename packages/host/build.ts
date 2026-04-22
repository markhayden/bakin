/**
 * Bakin host client bundle.
 *
 * Builds packages/host/src/main.tsx → packages/host/dist/main.mjs for the
 * browser. Externals (React, @bakin/sdk) get wired in Phase D of #147 —
 * at Phase C we still inline everything so the bundle is self-contained
 * while we stand the scaffold up.
 *
 * The static plugin manifest (src/lib/plugin-manifest.ts) transitively pulls
 * `@xyflow/react/dist/style.css` in through the workflows plugin, so the
 * bundler emits an asset stylesheet next to the main JS. This is expected
 * during Phase C — Phase F replaces the static manifest with a runtime
 * loader, which removes the coupling entirely. We use the [ext] token so
 * CSS and JS land at distinct paths without colliding on '.mjs'.
 */
import { rmSync } from 'node:fs'

// Always start from a clean dist so stale TC1 outputs don't linger.
rmSync('./packages/host/dist', { recursive: true, force: true })

await Bun.build({
  entrypoints: ['./packages/host/src/main.tsx'],
  outdir: './packages/host/dist',
  target: 'browser',
  format: 'esm',
  sourcemap: 'external',
  naming: {
    entry: '[name].[ext]',
    chunk: '[name]-[hash].[ext]',
    asset: '[name]-[hash].[ext]',
  },
})

console.log('packages/host: built')

export {}
