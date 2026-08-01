/**
 * Architecture scan over the TRACKED generated embed manifest
 * (packages/host/src/api/_embedded-assets-static.ts).
 *
 * The generator (scripts/generate-embedded-assets.ts) allowlists core plugin
 * browser assets (client.js/client.css) — server bundles must never be
 * embedded as servable browser assets (#421). The unit tests cover the
 * generator itself; this scan guards the committed output, so regenerating
 * with a stale/older generator and committing the result fails CI instead of
 * silently shipping ~2.3 MiB of server code in the binary.
 *
 * Pure scanner — reads the file as text, imports no app modules.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
const STATIC_MANIFEST = join(ROOT, 'packages/host/src/api/_embedded-assets-static.ts')

describe('embedded-assets static manifest (tracked generated output)', () => {
  const source = readFileSync(STATIC_MANIFEST, 'utf-8')

  it('embeds no core plugin server bundles', () => {
    const serverBundleKeys = source.match(/'\/api\/plugins\/[^']+\/assets\/index\.js'/g) ?? []
    expect(serverBundleKeys).toEqual([])
    expect(source).not.toMatch(/plugins\/[^'"]+\/dist\/index\.js/)
  })

  it('embeds no stray server-build artifacts (file-typed import emissions)', () => {
    expect(source).not.toContain('SKILL-')
  })

  it('still embeds core plugin browser assets', () => {
    expect(source).toContain("'/api/plugins/tasks/assets/client.js'")
    expect(source).toContain("'/api/plugins/team/assets/client.css'")
  })

  it('embeds the canonical SDK stylesheet once at the host stylesheet URL', () => {
    expect(source.match(/from '\.\.\/\.\.\/\.\.\/sdk\/styles\.css'/g)).toHaveLength(1)
    expect(source.match(/\['\/globals\.css', asset_globals_css\]/g)).toHaveLength(1)
  })
})
