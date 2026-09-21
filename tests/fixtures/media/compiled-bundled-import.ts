/**
 * TEETH fixture (#889): pins the premise that a compiled binary cannot use
 * sharp through the bare import (natives never survive `--compile`).
 * Compiled WITHOUT `--external sharp` and run from a temp cwd (no
 * node_modules in reach). If this ever prints BUNDLED IMPORT OK, bun learned
 * to embed sharp's natives — the whole media store machinery is obsolete.
 */
export {} // top-level await needs module context under tsc

try {
  const mod = (await import('sharp')) as { default?: unknown }
  const sharp = (mod.default ?? mod) as (input: Buffer) => { metadata(): Promise<{ width?: number }> }
  // Importing may succeed with a broken native — prove pixels or fail.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  const meta = await sharp(png).metadata()
  console.log(`BUNDLED IMPORT OK: ${meta.width}`)
} catch (err) {
  console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`)
}
