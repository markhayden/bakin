/**
 * media.sharp system check + repair (#889 T9).
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-health-media-${Date.now()}`)

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

// The repair's apply() imports the installer + loader lazily — intercept both.
let installCalls = 0
let installShouldFail = false
let lastInstallForce: boolean | undefined
let applyStoreStatus: 'ok' | 'missing' = 'missing'
let loaderLoads = false
mock.module('../../../packages/core/src/media/installer', () => ({
  checkMediaStore: () => (applyStoreStatus === 'ok'
    ? { status: 'ok' as const, receipt: { schema: 1, sharpVersion: '0.34.5', platform: 'darwin-arm64', entry: 'dist/index.js', installedAt: 'now', tarballs: [] } }
    : { status: 'missing' as const }),
  installMediaStore: async (opts?: { force?: boolean }) => {
    installCalls += 1
    lastInstallForce = opts?.force
    if (installShouldFail) throw new Error('registry unreachable (fixture)')
    return { storeDir: join(testDir, 'media', 'sharp', '0.34.5'), skipped: false }
  },
}))
mock.module('../../../packages/core/src/media/sharp-loader', () => ({
  loadSharp: async () => (loaderLoads ? ((() => ({})) as unknown) : null),
  resetSharpModuleCache: () => {},
}))

import { MEDIA_REPAIR_ACTION_ID, checkMediaSharp, mediaStoreRepair } from '../../../plugins/health/lib/system-checks/media'
import type { MediaStoreStatus } from '../../../packages/core/src/media/installer'

type Observation = {
  status: string
  key: string
  summary: string
  incident?: { key: string; disposition: string; class?: string; resolution?: { type: string; actionId?: string } }
}

const deps = (over: { bundled?: boolean; store?: MediaStoreStatus; loads?: boolean } = {}) => ({
  bundledSharpAvailable: async () => over.bundled ?? false,
  checkStore: (): MediaStoreStatus => over.store ?? { status: 'missing' },
  sharpLoads: async () => over.loads ?? false,
  sharpVersion: () => '0.34.5',
})

const firstObservation = (run: unknown): Observation =>
  (run as { observations: Observation[] }).observations[0]!

beforeEach(() => {
  installCalls = 0
  installShouldFail = false
  lastInstallForce = undefined
  applyStoreStatus = 'missing'
  loaderLoads = false
})

describe('checkMediaSharp', () => {
  it('healthy on a dev tree (bundled sharp)', async () => {
    const obs = firstObservation(await checkMediaSharp(deps({ bundled: true })))
    expect(obs.status).toBe('healthy')
    expect(obs.summary).toContain('bundled')
  })

  it('healthy with a store receipt at the pin AND a proven load', async () => {
    const obs = firstObservation(await checkMediaSharp(deps({
      store: { status: 'ok', receipt: { schema: 1, sharpVersion: '0.34.5', platform: 'darwin-arm64', entry: 'dist/index.js', installedAt: 'now', tarballs: [] } },
      loads: true,
    })))
    expect(obs.status).toBe('healthy')
    expect(obs.summary).toContain('media store')
  })

  it('a receipt that does NOT load is BROKEN, never healthy (fabricated-store hole, margo 2026-09-21)', async () => {
    const obs = firstObservation(await checkMediaSharp(deps({
      store: { status: 'ok', receipt: { schema: 1, sharpVersion: '0.34.5', platform: 'darwin-arm64', entry: 'dist/index.js', installedAt: 'now', tarballs: [] } },
      loads: false,
    })))
    expect(obs.status).toBe('error')
    expect(obs.incident?.key).toBe('media-store-broken')
    expect(obs.incident?.disposition).toBe('action_required')
    expect(obs.incident?.resolution).toMatchObject({ type: 'repair', actionId: MEDIA_REPAIR_ACTION_ID })
  })

  it('advisory unsupported_surface warning on platforms without prebuilds', async () => {
    const obs = firstObservation(await checkMediaSharp(deps({ store: { status: 'unsupported', platform: 'linux-riscv64' } })))
    expect(obs.status).toBe('warning')
    expect(obs.incident?.class).toBe('unsupported_surface')
    expect(obs.incident?.disposition).toBe('advisory')
  })

  it('missing store → UNCLASSIFIED action_required incident with the one-click repair', async () => {
    const obs = firstObservation(await checkMediaSharp(deps()))
    expect(obs.status).toBe('error')
    expect(obs.incident?.disposition).toBe('action_required')
    // Unclassified by design: never demoted under quiet sensitivity (#889).
    expect(obs.incident?.class).toBeUndefined()
    expect(obs.incident?.resolution).toMatchObject({ type: 'repair', actionId: MEDIA_REPAIR_ACTION_ID })
  })
})

describe('mediaStoreRepair', () => {
  const target = { kind: 'all' as const }

  it('plans a safe single-item install', async () => {
    const plan = await mediaStoreRepair().plan(target as never)
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ actionId: MEDIA_REPAIR_ACTION_ID, safety: 'safe' })
  })

  it('apply runs the installer and reports applied', async () => {
    const repair = mediaStoreRepair()
    const plan = await repair.plan(target as never)
    const results = await repair.apply(plan)
    expect(installCalls).toBe(1)
    expect(lastInstallForce).toBe(false)
    expect(results[0]).toMatchObject({ status: 'applied' })
    expect(results[0]!.message).toContain('no restart needed')
  })

  it('apply FORCES the reinstall past a receipt that does not load (fabricated store)', async () => {
    applyStoreStatus = 'ok'
    loaderLoads = false
    const repair = mediaStoreRepair()
    const plan = await repair.plan(target as never)
    await repair.apply(plan)
    expect(lastInstallForce).toBe(true)
  })

  it('apply reports failed honestly when the installer throws', async () => {
    installShouldFail = true
    const repair = mediaStoreRepair()
    const plan = await repair.plan(target as never)
    const results = await repair.apply(plan)
    expect(results[0]).toMatchObject({ status: 'failed' })
    expect(results[0]!.message).toContain('registry unreachable')
  })
})
