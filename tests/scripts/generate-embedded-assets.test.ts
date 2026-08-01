/**
 * Tests for the embedded-assets generator (scripts/generate-embedded-assets.ts).
 *
 * Runs collectAssets/emitManifest against a throwaway fixture tree — never
 * the real repo — so assertions stay hermetic. The generator script itself
 * only executes main() under `import.meta.main`, so importing it here is
 * side-effect free.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(tmpdir(), `bakin-test-embedded-assets-${Date.now()}`)

// The generator never touches the content dir, but mock the resolvers anyway
// (CLAUDE.md isolation rules) so no transitive import can reach ~/.bakin/.
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => root,
  getBakinPaths: () => ({}),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => root,
  getBakinPaths: () => ({}),
}))

import { collectAssets, emitManifest } from '../../scripts/generate-embedded-assets'

function seed(rel: string, content = '// stub\n'): void {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

// Fixture tree mirroring the real walk roots.
seed('packages/host/dist/main.js')
seed('packages/host/dist/main.js.map')                 // must be skipped
seed('packages/sdk/styles.css')
seed('packages/host/public/index.html')
seed('packages/host/public/vendor/react.js')
seed('packages/host/public/__bakin-dev/client.js')     // must never be walked
seed('plugins/alpha/dist/index.js')                    // server bundle
seed('plugins/alpha/dist/client.js')
seed('plugins/alpha/dist/client.css')
seed('plugins/alpha/dist/SKILL-abc123.md')             // stray server-build artifact
seed('plugins/beta/dist/index.js')                     // server-only plugin
seed('packages/host/src/data/curated-catalog.json', '[]')

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('collectAssets', () => {
  it('collects host, public, vendor, plugin dist, and data assets with serving URL paths', () => {
    const urls = collectAssets(root).map(a => a.urlPath)

    expect(urls).toContain('/_app/main.js')
    expect(urls).toContain('/globals.css')
    expect(urls).toContain('/index.html')
    expect(urls).toContain('/vendor/react.js')
    expect(urls).toContain('/api/plugins/alpha/assets/client.js')
    expect(urls).toContain('/api/plugins/alpha/assets/client.css')
    expect(urls).toContain('/data/curated-catalog.json')
  })

  it('excludes core plugin server bundles and stray dist artifacts (#421 allowlist)', () => {
    const urls = collectAssets(root).map(a => a.urlPath)

    expect(urls).not.toContain('/api/plugins/alpha/assets/index.js')
    expect(urls).not.toContain('/api/plugins/beta/assets/index.js')
    expect(urls).not.toContain('/api/plugins/alpha/assets/SKILL-abc123.md')
    // The allowlisted browser assets survive.
    expect(urls).toContain('/api/plugins/alpha/assets/client.js')
    expect(urls).toContain('/api/plugins/alpha/assets/client.css')
    // beta is server-only — nothing of it is embedded.
    expect(urls.some(u => u.startsWith('/api/plugins/beta/'))).toBe(false)
  })

  it('logs each skipped plugin dist file so exclusions are visible at build time', () => {
    const lines: string[] = []
    const original = console.log
    console.log = (msg: unknown) => { lines.push(String(msg)) }
    try {
      collectAssets(root)
    } finally {
      console.log = original
    }

    expect(lines).toContain('embedded-assets: skip plugins/alpha/dist/index.js (not in core-plugin allowlist)')
    expect(lines).toContain('embedded-assets: skip plugins/alpha/dist/SKILL-abc123.md (not in core-plugin allowlist)')
    expect(lines).toContain('embedded-assets: skip plugins/beta/dist/index.js (not in core-plugin allowlist)')
  })

  it('skips source maps and never walks the dev-client bundle', () => {
    const urls = collectAssets(root).map(a => a.urlPath)

    expect(urls.some(u => u.endsWith('.map'))).toBe(false)
    expect(urls.some(u => u.includes('__bakin-dev'))).toBe(false)
  })

  it('is deterministic across repeated calls in one process (no module-state leak)', () => {
    const first = collectAssets(root)
    const second = collectAssets(root)

    expect(second).toEqual(first)
    // No varName may pick up a collision suffix from a previous run.
    expect(second.every(a => !/_\d+$/.test(a.varName))).toBe(true)
  })

  it('preserves the walk order: host dist → SDK stylesheet → public → vendor → plugins → data', () => {
    const urls = collectAssets(root).map(a => a.urlPath)

    const order = [
      urls.indexOf('/_app/main.js'),
      urls.indexOf('/globals.css'),
      urls.indexOf('/vendor/react.js'),
      urls.indexOf('/api/plugins/alpha/assets/client.js'),
      urls.indexOf('/data/curated-catalog.json'),
    ]
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
})

describe('emitManifest', () => {
  it('emits file-typed imports relative to the out file and a URL-keyed map', () => {
    const outFile = join(root, 'packages/host/src/api/_embedded-assets-static.ts')
    const assets = collectAssets(root)
    const manifest = emitManifest(assets, outFile)

    expect(manifest).toContain("import asset_app_main_js from '../../dist/main.js' with { type: 'file' }")
    expect(manifest).toContain("import asset_api_plugins_alpha_assets_client_js from '../../../../plugins/alpha/dist/client.js' with { type: 'file' }")
    expect(manifest).toContain("  ['/_app/main.js', asset_app_main_js],")
    expect(manifest).toContain(`export const EMBEDDED_ASSET_COUNT = ${assets.length}`)
    expect(manifest).toContain('export const EMBEDDED_ASSETS_STATIC: ReadonlyMap<string, string>')
  })
})
