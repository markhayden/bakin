/**
 * Bakin host client bundle.
 *
 * Builds packages/host/src/main.tsx → packages/host/dist/main.mjs for the
 * browser. Externals (React, @bakin/sdk) get wired in Phase D of #147 —
 * at Phase C we still inline everything so the bundle is self-contained
 * while we stand the scaffold up.
 */
await Bun.build({
  entrypoints: ['./packages/host/src/main.tsx'],
  outdir: './packages/host/dist',
  target: 'browser',
  format: 'esm',
  sourcemap: 'external',
  naming: '[name].mjs',
})

console.log('packages/host: built')

export {}
