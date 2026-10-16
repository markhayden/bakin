/**
 * CLI targeting (#895 D11): an explicit BAKIN_URL wins; otherwise the live
 * server.lock in the CLI's own home gives the port; otherwise no server runs
 * for this home and server-only verbs refuse with BakinNotRunningError —
 * never a guess at port 3737.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-cli-target-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

import { readLiveServerLock } from '../../src/core/server-lock'
import {
  BakinNotRunningError,
  describeCliTarget,
  isServerConnectionError,
  resolveCliTarget,
  serverBaseUrl,
} from '../../src/cli/http'

function writeLock(pid: number, port: number) {
  writeFileSync(join(testDir, 'server.lock'), JSON.stringify({ pid, port, startedAt: Date.now(), bootId: 'b' }))
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

describe('readLiveServerLock', () => {
  it('returns the lock of a live process and nothing for a dead pid or no lock', () => {
    expect(readLiveServerLock()).toBeNull()
    writeLock(process.pid, 3797)
    expect(readLiveServerLock()).toMatchObject({ pid: process.pid, port: 3797 })
    // pid 2^22-ish far above any live pid on a test machine
    writeLock(4_194_000, 3797)
    expect(readLiveServerLock()).toBeNull()
  })
})

describe('resolveCliTarget', () => {
  it('uses the live lock port of this home, not the default', () => {
    expect(resolveCliTarget({}, { pid: 42, port: 3797 })).toEqual({ baseUrl: 'http://localhost:3797', source: 'lock', pid: 42 })
  })

  it('has no target when there is no live lock (no guess at another home on 3737)', () => {
    const target = resolveCliTarget({}, null)
    expect(target.source).toBe('none')
    expect(() => serverBaseUrl(target)).toThrow(BakinNotRunningError)
    expect(describeCliTarget(target)).toContain(testDir)
  })

  it('an explicit BAKIN_URL wins over the lock, even a loopback URL pointing elsewhere', () => {
    const target = resolveCliTarget({ BAKIN_URL: 'http://127.0.0.1:4100/' }, { pid: 42, port: 3797 })
    expect(target).toEqual({ baseUrl: 'http://127.0.0.1:4100', source: 'env' })
    expect(serverBaseUrl(target)).toBe('http://127.0.0.1:4100')
    expect(describeCliTarget(target)).toBe('http://127.0.0.1:4100 (BAKIN_URL)')
  })

  it('treats not-running as a connection failure for the shared error path', () => {
    expect(isServerConnectionError(new BakinNotRunningError())).toBe(true)
    expect(new BakinNotRunningError().message).toContain('bakin start')
  })
})
