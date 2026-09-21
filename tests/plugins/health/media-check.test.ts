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

// The repair's apply() imports the installer lazily — intercept it.
let installCalls = 0
let installShouldFail = false
mock.module('../../../packages/core/src/media/installer', () => ({
  checkMediaStore: () => ({ status: 'missing' as const }),
  installMediaStore: async () => {
    installCalls += 1
    if (installShouldFail) throw new Error('registry unreachable (fixture)')
    return { storeDir: join(testDir, 'media', 'sharp', '0.34.5'), skipped: false }
  },
}))

import { MEDIA_REPAIR_ACTION_ID, checkMediaSharp, mediaStoreRepair } from '../../../plugins/health/lib/system-checks/media'
import type { MediaStoreStatus } from '../../../packages/core/src/media/installer'

type Observation = {
  status: string
  key: string
  summary: string
  incident?: { key: string; disposition: string; class?: string; resolution?: { type: string; actionId?: string } }
}

const deps = (over: { bundled?: boolean; store?: MediaStoreStatus } = {}) => ({
  bundledSharpAvailable: async () => over.bundled ?? false,
  checkStore: (): MediaStoreStatus => over.store ?? { status: 'missing' },
  sharpVersion: () => '0.34.5',
})

const firstObservation = (run: unknown): Observation =>
  (run as { observations: Observation[] }).observations[0]!

beforeEach(() => {
  installCalls = 0
  installShouldFail = false
})

describe('checkMediaSharp', () => {
  it('healthy on a dev tree (bundled sharp)', async () => {
    const obs = firstObservation(await checkMediaSharp(deps({ bundled: true })))
    expect(obs.status).toBe('healthy')
    expect(obs.summary).toContain('bundled')
  })

  it('healthy with a store receipt at the pin', async () => {
    const obs = firstObservation(await checkMediaSharp(deps({
      store: { status: 'ok', receipt: { schema: 1, sharpVersion: '0.34.5', platform: 'darwin-arm64', entry: 'dist/index.js', installedAt: 'now', tarballs: [] } },
    })))
    expect(obs.status).toBe('healthy')
    expect(obs.summary).toContain('media store')
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
    expect(results[0]).toMatchObject({ status: 'applied' })
    expect(results[0]!.message).toContain('no restart needed')
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
