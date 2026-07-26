import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import fs from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-delivery-boot-${Date.now()}`)

mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { shouldBootDeliveryBridge, bootDeliveryBridge, shutdownDeliveryBridge } from '../../../src/core/delivery'
import { resetSettingsCache } from '../../../packages/core/src/settings'

describe('delivery bridge boot gating (D11)', () => {
  beforeEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true })
    fs.mkdirSync(testDir, { recursive: true })
    resetSettingsCache()
  })
  afterAll(async () => {
    await shutdownDeliveryBridge()
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it('boots only when configured AND the runtime lacks native delivery', () => {
    expect(shouldBootDeliveryBridge(true, 'unavailable')).toBe(true)
    expect(shouldBootDeliveryBridge(true, 'shimmed')).toBe(true)
    expect(shouldBootDeliveryBridge(true, 'native')).toBe(false)
    expect(shouldBootDeliveryBridge(false, 'unavailable')).toBe(false)
    expect(shouldBootDeliveryBridge(false, 'native')).toBe(false)
  })

  it('bootDeliveryBridge is a safe no-op when unconfigured (no transport import)', async () => {
    const booted = await bootDeliveryBridge({
      capabilities: async () => ({ delivery: { mode: 'unavailable' as const } }),
    })
    expect(booted).toBe(false)
  })

  it('bootDeliveryBridge skips native-delivery runtimes even when configured-ish', async () => {
    const booted = await bootDeliveryBridge({
      capabilities: async () => ({ delivery: { mode: 'native' as const } }),
    })
    expect(booted).toBe(false)
  })
})
