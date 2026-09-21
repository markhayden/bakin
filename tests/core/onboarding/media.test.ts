/**
 * Onboarding component `media` (#889 T8): check/install truth table over
 * mocked loader legs and installer.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-onboarding-media-${Date.now()}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../../packages/core/src/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

let bundledAvailable = false
mock.module('../../../packages/core/src/media/sharp-import', () => ({
  importBundledSharp: async () => {
    if (!bundledAvailable) throw new Error('no bundled sharp (fixture)')
    return { default: () => ({}) }
  },
  importStoreBundle: async () => ({ default: () => ({}) }),
}))

type StoreStatus =
  | { status: 'ok'; receipt: { sharpVersion: string; platform: string } }
  | { status: 'missing' }
  | { status: 'unsupported'; platform: string }
let storeStatus: StoreStatus = { status: 'missing' }
let installCalls = 0
let installShouldFail = false
mock.module('../../../packages/core/src/media/installer', () => ({
  checkMediaStore: () => storeStatus,
  installMediaStore: async () => {
    installCalls += 1
    if (installShouldFail) throw new Error('download failed (fixture)')
    storeStatus = { status: 'ok', receipt: { sharpVersion: '0.34.5', platform: 'darwin-arm64' } }
    return { storeDir: join(testDir, 'media', 'sharp', '0.34.5'), skipped: false }
  },
}))

import { mediaComponent } from '../../../src/core/onboarding/media'

const opts = (over: Partial<Parameters<typeof mediaComponent.install>[0]> = {}) => ({
  interactive: false,
  autoApprove: true,
  json: false,
  checkOnly: false,
  force: false,
  ...over,
})

beforeEach(() => {
  bundledAvailable = false
  storeStatus = { status: 'missing' }
  installCalls = 0
  installShouldFail = false
})

describe('mediaComponent.check', () => {
  it('ok on a dev tree (bundled sharp importable)', async () => {
    bundledAvailable = true
    const result = await mediaComponent.check()
    expect(result.status).toBe('ok')
    expect(result.message).toContain('node_modules')
  })

  it('ok when the media store is installed', async () => {
    storeStatus = { status: 'ok', receipt: { sharpVersion: '0.34.5', platform: 'darwin-arm64' } }
    const result = await mediaComponent.check()
    expect(result.status).toBe('ok')
    expect(result.message).toContain('media store')
  })

  it('warn on an unsupported platform', async () => {
    storeStatus = { status: 'unsupported', platform: 'linux-riscv64' }
    const result = await mediaComponent.check()
    expect(result.status).toBe('warn')
    expect(result.message).toContain('linux-riscv64')
  })

  it('missing (with remediation) when neither leg is available', async () => {
    const result = await mediaComponent.check()
    expect(result.status).toBe('missing')
    expect(result.remediation).toContain('bakin install media')
  })
})

describe('mediaComponent.install', () => {
  it('noop when already ok', async () => {
    bundledAvailable = true
    const result = await mediaComponent.install(opts())
    expect(result.status).toBe('noop')
    expect(installCalls).toBe(0)
  })

  it('skipped on an unsupported platform', async () => {
    storeStatus = { status: 'unsupported', platform: 'linux-riscv64' }
    const result = await mediaComponent.install(opts())
    expect(result.status).toBe('skipped')
    expect(installCalls).toBe(0)
  })

  it('installs when approved', async () => {
    const result = await mediaComponent.install(opts())
    expect(result.status).toBe('installed')
    expect(installCalls).toBe(1)
  })

  it('installs when the component is in approvedComponents', async () => {
    const result = await mediaComponent.install(opts({ autoApprove: false, approvedComponents: ['media'] }))
    expect(result.status).toBe('installed')
  })

  it('skipped when neither approved nor interactive', async () => {
    const result = await mediaComponent.install(opts({ autoApprove: false }))
    expect(result.status).toBe('skipped')
    expect(installCalls).toBe(0)
  })

  it('failed (honestly) when the installer throws', async () => {
    installShouldFail = true
    const result = await mediaComponent.install(opts())
    expect(result.status).toBe('failed')
    expect(result.message).toContain('download failed')
  })
})
