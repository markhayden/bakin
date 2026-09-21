/**
 * Sharp loader legs + failure re-probe (#889 T6).
 *
 * The import seam (./sharp-import) and the store resolver are mocked with
 * factories whose closures read mutable state at CALL time — the repo's
 * devDependency sharp would otherwise satisfy the bundled leg in every test.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-sharp-loader-${Date.now()}-${Math.random().toString(16).slice(2)}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
}))
mock.module('../../../packages/core/src/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

// Controllable legs, read at call time.
const fakeBundledSharp = (input: string) => ({ __engine: 'bundled', input })
let bundledAvailable = false
let storeEntry: string | null = null
let storeBundleBroken = false
let bundledImports = 0
let storeImports = 0

mock.module('../../../packages/core/src/media/sharp-import', () => ({
  importBundledSharp: async () => {
    bundledImports += 1
    if (!bundledAvailable) throw new Error("Cannot find module 'sharp' (fixture)")
    return { default: fakeBundledSharp }
  },
  importStoreBundle: async (entry: string) => {
    storeImports += 1
    if (storeBundleBroken) throw new Error('corrupt bundle (fixture)')
    return { default: (input: string) => ({ __engine: `store:${entry}`, input }) }
  },
}))
mock.module('../../../packages/core/src/media/store', () => ({
  mediaStoreEntry: () => storeEntry,
}))

import { loadSharp, resetSharpModuleCache } from '../../../packages/core/src/media/sharp-loader'

const engineOf = (sharp: unknown): string =>
  (sharp as (i: string) => { __engine: string })('x').__engine

beforeEach(() => {
  resetSharpModuleCache()
  bundledAvailable = false
  storeEntry = null
  storeBundleBroken = false
  bundledImports = 0
  storeImports = 0
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('loadSharp', () => {
  it('prefers the bundled sharp import (dev tree)', async () => {
    bundledAvailable = true
    const sharp = await loadSharp()
    expect(engineOf(sharp)).toBe('bundled')
    expect(storeImports).toBe(0)
  })

  it('falls back to the media store bundle when the bundled import fails', async () => {
    storeEntry = '/store/dist/index.js'
    const sharp = await loadSharp()
    expect(sharp).not.toBeNull()
    expect(engineOf(sharp)).toBe('store:/store/dist/index.js')
  })

  it('returns null when neither leg is available', async () => {
    expect(await loadSharp()).toBeNull()
  })

  it('caches a success (no re-import churn)', async () => {
    bundledAvailable = true
    const first = await loadSharp()
    bundledAvailable = false
    expect(await loadSharp()).toBe(first!)
    expect(bundledImports).toBe(1)
  })

  it('re-probes a cached failure once a store entry appears (install without restart)', async () => {
    expect(await loadSharp()).toBeNull()
    // `bakin install media` lands the store while this process is running.
    storeEntry = '/store/dist/index.js'
    const sharp = await loadSharp()
    expect(sharp).not.toBeNull()
    expect(engineOf(sharp)).toBe('store:/store/dist/index.js')
  })

  it('does NOT retry a failure when the same store entry was already tried', async () => {
    storeEntry = '/store/dist/index.js'
    storeBundleBroken = true
    expect(await loadSharp()).toBeNull()
    // Same entry still there — cached null holds (no import loop).
    expect(await loadSharp()).toBeNull()
    expect(storeImports).toBe(1)
  })

  it('resetSharpModuleCache forces a full reload (installer repair path)', async () => {
    expect(await loadSharp()).toBeNull()
    bundledAvailable = true
    expect(await loadSharp()).toBeNull() // still cached, no store to trigger a re-probe
    resetSharpModuleCache()
    const sharp = await loadSharp()
    expect(sharp).not.toBeNull()
    expect(engineOf(sharp)).toBe('bundled')
  })
})
