/**
 * Lock acquisition opens the lock file BEFORE the first flock(2) call lazily
 * loads libc through bun:ffi (#896 review r4). When that load fails — a
 * hardened binary without the executable-memory entitlements, a libc
 * nobody could name — the open descriptor must still be closed, or every
 * failed attempt leaks one until the process exits.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import * as realFs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-lock-ffi-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, home: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../packages/core/src/logger', () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) }))

// Captured BEFORE node:fs is mocked (live namespace binding — see resources-failure.test.ts).
const realModule = { ...realFs }
const realOpenSync = realFs.openSync
const realCloseSync = realFs.closeSync
const openedFds = new Set<number>()
mock.module('node:fs', () => ({
  ...realModule,
  openSync: (...args: Parameters<typeof realOpenSync>) => {
    const fd = realOpenSync(...args)
    openedFds.add(fd)
    return fd
  },
  closeSync: (fd: number) => {
    openedFds.delete(fd)
    return realCloseSync(fd)
  },
}))

// Every libc candidate fails to load: the first flock() throws after the lock file is open.
mock.module('bun:ffi', () => ({
  FFIType: { i32: 'i32' },
  dlopen: (name: string) => { throw new Error(`dlopen(${name}): code signature invalid`) },
}))

const { acquireResources, isResourceHeld, tryAcquireResources } = await import('../../../packages/core/src/operations/resources')

beforeEach(() => {
  openedFds.clear()
  realModule.rmSync(testDir, { recursive: true, force: true })
  realModule.mkdirSync(testDir, { recursive: true })
})
afterAll(() => realModule.rmSync(testDir, { recursive: true, force: true }))

describe('libc fails to load on the first flock', () => {
  it('acquisition throws a named error and closes the descriptor it opened', async () => {
    await expect(acquireResources(['install-state'], { identity: { title: 'op', operationId: 'op-1' } })).rejects.toThrow(/flock\(2\) from libc.*code signature invalid/)
    expect(openedFds.size).toBe(0)
  })

  it('repeated failures accumulate no open descriptors', async () => {
    for (let i = 0; i < 3; i++) {
      await expect(acquireResources(['media-store'], { identity: { title: 'op', operationId: `op-${i}` } })).rejects.toThrow(/flock\(2\) from libc/)
      expect(() => tryAcquireResources(['search-engine'], { title: 'try', operationId: `try-${i}` })).toThrow(/flock\(2\) from libc/)
    }
    expect(openedFds.size).toBe(0)
  })

  it('the probe closes its descriptor too', () => {
    realModule.writeFileSync(join(testDir, 'install.lock'), '{}')
    expect(() => isResourceHeld('install-state')).toThrow(/flock\(2\) from libc/)
    expect(openedFds.size).toBe(0)
  })
})
