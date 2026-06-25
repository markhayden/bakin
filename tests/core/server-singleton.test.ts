/**
 * Server singleton lock (SPEC §8 test #7). Two server processes can never
 * run: the second `bakin start` refuses with the live holder's pid; a stale
 * lock (dead pid) is replaced; clean shutdown releases.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-server-lock-${Date.now()}-${randomUUID()}`)

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import { acquireServerLock, releaseServerLock, readServerLock } from '../../src/core/server-lock'

const lockPath = () => join(testDir, 'server.lock')

/** A pid that is certainly not alive: spawn-and-reap is overkill — use a
 *  huge pid beyond pid_max. process.kill throws ESRCH for it. */
const DEAD_PID = 2 ** 30

beforeEach(() => {
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('server singleton lock', () => {
  it('acquires when no lock exists and records pid/port/bootId', () => {
    const result = acquireServerLock(3737, 'boot-1')
    expect(result.acquired).toBe(true)

    const lock = JSON.parse(readFileSync(lockPath(), 'utf-8'))
    expect(lock.pid).toBe(process.pid)
    expect(lock.port).toBe(3737)
    expect(lock.bootId).toBe('boot-1')
    releaseServerLock()
  })

  it('refuses while a LIVE process holds the lock, naming the pid', () => {
    // Our own pid is alive by definition — simulate another live holder.
    writeFileSync(lockPath(), JSON.stringify({ pid: process.pid, port: 3737, startedAt: Date.now(), bootId: 'other' }))
    // Re-acquiring our own pid is allowed (HMR/restart in-process)…
    expect(acquireServerLock(3737, 'boot-2').acquired).toBe(true)

    // …but a DIFFERENT live pid refuses. Use pid 1 (launchd — always alive).
    writeFileSync(lockPath(), JSON.stringify({ pid: 1, port: 3737, startedAt: Date.now(), bootId: 'other' }))
    const refused = acquireServerLock(3737, 'boot-3')
    expect(refused.acquired).toBe(false)
    if (!refused.acquired) {
      expect(refused.holder.pid).toBe(1)
      expect(refused.holder.port).toBe(3737)
    }
  })

  it('replaces a stale lock (dead pid)', () => {
    writeFileSync(lockPath(), JSON.stringify({ pid: DEAD_PID, port: 3737, startedAt: Date.now() - 60_000, bootId: 'dead' }))
    const result = acquireServerLock(3838, 'boot-4')
    expect(result.acquired).toBe(true)
    expect(readServerLock()?.pid).toBe(process.pid)
    expect(readServerLock()?.port).toBe(3838)
    releaseServerLock()
  })

  it('replaces a corrupt lock file', () => {
    writeFileSync(lockPath(), 'not json{{{')
    expect(acquireServerLock(3737, 'boot-5').acquired).toBe(true)
    releaseServerLock()
  })

  it('release removes only OUR lock', () => {
    acquireServerLock(3737, 'boot-6')
    releaseServerLock()
    expect(existsSync(lockPath())).toBe(false)

    // A lock held by someone else is never deleted by our release.
    writeFileSync(lockPath(), JSON.stringify({ pid: 1, port: 3737, startedAt: Date.now(), bootId: 'other' }))
    releaseServerLock()
    expect(existsSync(lockPath())).toBe(true)
  })

  it('release is safe with no lock present', () => {
    expect(() => releaseServerLock()).not.toThrow()
  })
})
