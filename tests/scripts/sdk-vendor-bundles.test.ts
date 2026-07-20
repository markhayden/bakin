/**
 * Tests for the split SDK vendor build (scripts/build-vendors.ts, #422).
 *
 * Runs buildSdkVendorBundles() against a temp outDir (a real subprocess
 * bun build — a few seconds) and asserts the two structural properties
 * the splitting layout exists to provide:
 *
 *  1. Shared code is deduplicated: code used by more than one SDK subpath
 *     lands in sdk-shared-*.js chunks exactly once, never inlined into
 *     multiple subpath bundles. Verified with a marker string from the
 *     shadcn form/label primitives, which the pre-splitting layout
 *     duplicated across sdk-ui.js and sdk-components.js.
 *  2. The published entry contract holds: every stable sdk-*.js entry
 *     files exist and expose their representative exports, so the import
 *     map in packages/host/public/index.html keeps resolving every
 *     @makinbakin/sdk/* specifier without changes.
 */
import { afterAll, beforeAll, describe, expect, it, mock, setDefaultTimeout } from 'bun:test'
import { mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const outDir = join(tmpdir(), `bakin-test-sdk-vendor-${Date.now()}`)

// The vendor build never touches the content dir, but mock the resolvers
// anyway (CLAUDE.md isolation rules) so no transitive import can reach
// ~/.bakin/.
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => outDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => outDir,
  getBakinPaths: () => ({}),
}))

import { SDK_VENDOR_TARGETS, buildSdkVendorBundles } from '../../scripts/build-vendors'

/**
 * A literal from the shadcn form/label primitives. Shared by the ui and
 * components subpaths; before the splitting layout it was inlined into
 * both bundles. If this assertion starts failing because shadcn renamed
 * the class, pick any literal that grep finds in two or more sdk-*.js
 * files after temporarily reverting to per-subpath builds.
 */
const SHARED_MARKER = 'peer-disabled:cursor-not-allowed'

setDefaultTimeout(60_000)

beforeAll(async () => {
  mkdirSync(outDir, { recursive: true })
  await buildSdkVendorBundles({ outDir, production: true })
  // The bundles externalize `react` and `@tanstack/react-router` (the
  // browser resolves them via the import map). For the dynamic-import
  // contract test below, give the temp dir the repo's node_modules so
  // those bare specifiers resolve the same way.
  symlinkSync(resolve(import.meta.dir, '../../node_modules'), join(outDir, 'node_modules'))
})

afterAll(() => rmSync(outDir, { recursive: true, force: true }))

describe('split SDK vendor build', () => {
  it('emits every stable entry file plus shared chunks', () => {
    const files = readdirSync(outDir).filter((f) => f !== 'node_modules')
    for (const target of SDK_VENDOR_TARGETS) {
      expect(files).toContain(`${target.name}.js`)
    }
    const chunks = files.filter((f) => f.startsWith('sdk-shared-') && f.endsWith('.js'))
    expect(chunks.length).toBeGreaterThan(0)
    // No build intermediates may survive — generate-embedded-assets embeds
    // everything it finds under vendor/.
    expect(files.filter((f) => f.endsWith('.ts'))).toEqual([])
  })

  it('deduplicates shared code into a single chunk', () => {
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const containing = files.filter((f) => readFileSync(join(outDir, f), 'utf-8').includes(SHARED_MARKER))
    expect(containing.length).toBeLessThanOrEqual(1)
  })

  it('keeps the representative exports of every import-map specifier', async () => {
    const sdkIndex = await import(join(outDir, 'sdk-index.js'))
    expect(typeof sdkIndex.registerPlugin).toBe('function')

    const hooks = await import(join(outDir, 'sdk-hooks.js'))
    expect(typeof hooks.useQueryState).toBe('function')
    expect(typeof hooks.useQueryArrayState).toBe('function')

    const slots = await import(join(outDir, 'sdk-slots.js'))
    expect(typeof slots.registerSlot).toBe('function')
    expect(slots.Slot).toBeDefined()

    const components = await import(join(outDir, 'sdk-components.js'))
    expect(components.PluginHeader).toBeDefined()
    expect(components.FacetFilter).toBeDefined()

    const ui = await import(join(outDir, 'sdk-ui.js'))
    expect(ui.Button).toBeDefined()

    const layout = await import(join(outDir, 'sdk-layout.js'))
    expect(layout.PageShell).toBeDefined()

    const patterns = await import(join(outDir, 'sdk-patterns.js'))
    expect(patterns.FacetFilter).toBeDefined()
    expect(patterns.SegmentedControl).toBeDefined()

    for (const name of ['charts', 'conversation']) {
      const focused = await import(join(outDir, `sdk-${name}.js`))
      expect(Object.keys(focused)).toEqual([])
    }

    const utils = await import(join(outDir, 'sdk-utils.js'))
    expect(typeof utils.cn).toBe('function')
  })
})
