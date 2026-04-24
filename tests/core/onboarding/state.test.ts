/**
 * Tests for the .onboarded marker file I/O.
 *
 * Test hygiene: content-dir is mocked to a temp directory so no real
 * ~/.bakin/ is touched. The logger is stubbed to keep warnings out of the
 * test output.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let testDir: string

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

describe('onboarding state', () => {
  let loadState: typeof import('../../../src/core/onboarding/state').loadState
  let saveState: typeof import('../../../src/core/onboarding/state').saveState
  let isOnboarded: typeof import('../../../src/core/onboarding/state').isOnboarded
  let clearMarker: typeof import('../../../src/core/onboarding/state').clearMarker
  let ONBOARDING_VERSION: typeof import('../../../src/core/onboarding/state').ONBOARDING_VERSION

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'bakin-onboarding-state-'))
    vi.resetModules()
    const mod = await import('../../../src/core/onboarding/state')
    loadState = mod.loadState
    saveState = mod.saveState
    isOnboarded = mod.isOnboarded
    clearMarker = mod.clearMarker
    ONBOARDING_VERSION = mod.ONBOARDING_VERSION
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('loadState returns null when the marker is missing', () => {
    expect(loadState()).toBeNull()
    expect(isOnboarded()).toBe(false)
  })

  it('saveState writes a well-formed marker and loadState reads it back', () => {
    const state = saveState({ mkdir: 'ok', antfly: 'ok', llm: 'warn' }, '1.2.3')

    expect(state.version).toBe(ONBOARDING_VERSION)
    expect(state.bakinVersion).toBe('1.2.3')
    expect(state.components).toEqual({ mkdir: 'ok', antfly: 'ok', llm: 'warn' })
    expect(typeof state.completedAt).toBe('string')

    const onDisk = JSON.parse(readFileSync(join(testDir, '.onboarded'), 'utf-8'))
    expect(onDisk).toEqual(state)

    const reloaded = loadState()
    expect(reloaded).toEqual(state)
  })

  it('saveState creates parent directory when content dir is missing', () => {
    const nested = join(testDir, 'not-yet-created')
    testDir = nested
    saveState({ mkdir: 'ok' })
    expect(existsSync(join(nested, '.onboarded'))).toBe(true)
  })

  it('isOnboarded returns true for a fresh write', () => {
    saveState({ mkdir: 'ok' })
    expect(isOnboarded()).toBe(true)
  })

  it('isOnboarded returns false when stored version is older than code', () => {
    const olderMarker = {
      version: ONBOARDING_VERSION - 1,
      completedAt: '2020-01-01T00:00:00.000Z',
      bakinVersion: '0.0.1',
      components: { mkdir: 'ok' },
    }
    writeFileSync(join(testDir, '.onboarded'), JSON.stringify(olderMarker), 'utf-8')
    expect(isOnboarded()).toBe(false)
  })

  it('loadState returns null for corrupt JSON', () => {
    writeFileSync(join(testDir, '.onboarded'), 'not-json{', 'utf-8')
    expect(loadState()).toBeNull()
    expect(isOnboarded()).toBe(false)
  })

  it('loadState returns null for a marker with unexpected shape', () => {
    writeFileSync(join(testDir, '.onboarded'), JSON.stringify({ foo: 'bar' }), 'utf-8')
    expect(loadState()).toBeNull()
  })

  it('clearMarker removes the file and is idempotent', () => {
    saveState({ mkdir: 'ok' })
    expect(existsSync(join(testDir, '.onboarded'))).toBe(true)
    clearMarker()
    expect(existsSync(join(testDir, '.onboarded'))).toBe(false)
    // Second call must not throw.
    clearMarker()
    expect(existsSync(join(testDir, '.onboarded'))).toBe(false)
  })
})
