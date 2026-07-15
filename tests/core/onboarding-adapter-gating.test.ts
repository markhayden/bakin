/**
 * Onboarding per-adapter gating (P12): OpenClaw-only components skip on
 * adapter 'pi', run on 'openclaw'; adapter-generic components unaffected.
 */
import { describe, test, expect, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-onboard-gate-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.PI_HOME = join(testDir, 'pi')

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db'), settings: join(testDir, 'settings.json') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

let adapterName = 'pi'
mock.module('../../src/core/settings', () => ({
  getSettings: () => ({ runtime: { adapter: adapterName, settings: {} } }),
  resetSettingsCache: () => {},
}))

import { openClawIntegrationComponent } from '../../src/core/onboarding/openclaw-integration'
import { mkdirComponent } from '../../src/core/onboarding/mkdir'
import { checkAll } from '../../src/core/onboarding/index'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('onboarding adapter gating', () => {
  test('openclaw-only components declare supportedAdapters', () => {
    expect(openClawIntegrationComponent.supportedAdapters).toEqual(['openclaw'])
    expect(mkdirComponent.supportedAdapters).toBeUndefined()
  })

  test("checkAll on adapter 'pi' skips openclaw-only components without calling them", async () => {
    adapterName = 'pi'
    const results = await checkAll()
    const openclaw = results.find((r) => r.name === 'openclaw-integration')
    expect(openclaw?.message).toContain('not applicable')
    expect(openclaw?.status).toBe('ok')
    // Generic components still genuinely ran (mkdir reports on real temp home).
    const mkdir = results.find((r) => r.name === 'mkdir')
    expect(mkdir?.message ?? '').not.toContain('not applicable')
    // Real components under full-suite CPU contention overrun the default
    // 15s occasionally (#650 class) — generous wall clock, same assertions.
  }, 45_000)

  test("checkAll on adapter 'openclaw' does NOT skip them", async () => {
    adapterName = 'openclaw'
    const results = await checkAll()
    const openclaw = results.find((r) => r.name === 'openclaw-integration')
    expect(openclaw?.message ?? '').not.toContain('not applicable')
  })
})
