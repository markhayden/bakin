/**
 * Reproduces the import shape of packages/host/src/api/_embedded-assets-static.ts
 * (a `with { type: 'file' }` import of the curated catalog) WITHOUT dragging
 * the manifest's built-artifact imports (dist/main.js, vendor bundles) into
 * the test module graph — those only exist after a full build (CI runs
 * tests unbuilt).
 */
import catalogAsFile from '../../packages/host/src/data/curated-catalog.json' with { type: 'file' }

export const catalogFilePath = catalogAsFile as unknown as string
