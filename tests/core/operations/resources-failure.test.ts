/**
 * Failure injection for flock-held resource locks (#896 review): a lock
 * taken by the kernel must never outlive an acquisition that then throws —
 * the metadata write (full disk), a reclaim callback, or a later resource
 * in the same acquisition. Every such failure leaves the resource free.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import * as realFs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-lock-failure-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, home: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../packages/core/src/logger', () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) }))

// Captured BEFORE the module is mocked: the namespace import is a live
// binding and would otherwise point at the mock itself (infinite recursion).
const realWriteSync = realFs.writeSync
const realModule = { ...realFs }
let failWrite = false
mock.module('node:fs', () => ({
  ...realModule,
  writeSync: (...args: Parameters<typeof realWriteSync>) => {
    if (failWrite) { const err = new Error('ENOSPC: no space left on device') as NodeJS.ErrnoException; err.code = 'ENOSPC'; throw err }
    return realWriteSync(...args)
  },
}))

const { acquireResources, isResourceHeld, tryAcquireResources } = await import('../../../packages/core/src/operations/resources')

beforeEach(() => {
  failWrite = false
  realModule.rmSync(testDir, { recursive: true, force: true })
  realModule.mkdirSync(testDir, { recursive: true })
})
afterAll(() => realModule.rmSync(testDir, { recursive: true, force: true }))

const identity = (operationId: string) => ({ title: `op ${operationId}`, operationId })

describe('a failed acquisition never leaves the kernel lock held', () => {
  it('metadata write fails (ENOSPC): the descriptor is closed and the resource is free again', async () => {
    failWrite = true
    await expect(acquireResources(['media-store'], { identity: identity('op-1') })).rejects.toThrow(/ENOSPC/)
    expect(isResourceHeld('media-store')).toBe(false)
    failWrite = false
    const lease = await acquireResources(['media-store'], { identity: identity('op-2') })
    expect(isResourceHeld('media-store')).toBe(true)
    lease.release()
    expect(isResourceHeld('media-store')).toBe(false)
  })

  it('a throwing onReclaim callback releases the lock it was told about', async () => {
    const path = join(testDir, 'locks', 'media-store.lock')
    realModule.mkdirSync(join(testDir, 'locks'), { recursive: true })
    realModule.writeFileSync(path, JSON.stringify({ pid: 2 ** 22 + 7, acquiredAt: '2026-01-01T00:00:00.000Z', title: 'dead' }))
    await expect(acquireResources(['media-store'], { identity: identity('op-3'), onReclaim: () => { throw new Error('reporter exploded') } }))
      .rejects.toThrow('reporter exploded')
    expect(isResourceHeld('media-store')).toBe(false)
  })

  it('tryAcquireResources releases earlier resources when a later one throws', async () => {
    let writes = 0
    const original = failWrite
    // The first resource's metadata write succeeds, the second one's fails.
    mock.module('node:fs', () => ({
      ...realModule,
      writeSync: (...args: Parameters<typeof realWriteSync>) => {
        writes += 1
        if (writes === 2) { const err = new Error('ENOSPC') as NodeJS.ErrnoException; err.code = 'ENOSPC'; throw err }
        return realWriteSync(...args)
      },
    }))
    try {
      expect(() => tryAcquireResources(['install-state', 'media-store'], identity('op-4'))).toThrow(/ENOSPC/)
      expect(isResourceHeld('install-state')).toBe(false)
      expect(isResourceHeld('media-store')).toBe(false)
    } finally {
      failWrite = original
    }
  })
})
