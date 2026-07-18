/**
 * Source-level guards over scripts/generate-embedded-assets.ts.
 *
 * Migrated from tests/api/curated.test.ts when /api/curated was removed —
 * these describes are independent of any route and protect two contracts:
 *   - agent packages are never baked into the binary
 *   - release binaries fail loudly when required host assets are missing
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const script = readFileSync(
  join(import.meta.dir, '..', '..', 'scripts/generate-embedded-assets.ts'),
  'utf-8',
)

describe('embedded-assets builder excludes agents/', () => {
  it('the asset-source collector never walks the agents/ directory', () => {
    // Source-level assertion: grep the embedded-assets script for any
    // walker that targets agents/. The exclusion is by omission — the
    // walk paths are explicit (host/dist, host/public, plugins/*/dist,
    // host/src/data). If a future change accidentally adds an agents/
    // walker, this test fires.
    expect(script).not.toContain("walk(join(repoRoot, 'agents')")
    expect(script).not.toContain('walk(agentsDir')
    expect(script).not.toContain("'/agents'")

    // Positively confirm the explicit walks are still there
    expect(script).toContain("walk(join(repoRoot, 'packages/host/dist'), '/_app'")
    expect(script).toContain('walk(distDir')
  })
})

describe('embedded-assets builder required host assets', () => {
  it('guards against release binaries missing generated CSS', () => {
    expect(script).toContain('packages/sdk/styles.css')
    expect(script).toContain('bun run build:css')
    expect(script).toContain('Cannot generate embedded assets because required host assets are missing')
  })
})
