/**
 * Operation resources (D23): one O_EXCL lock file per resource with holder
 * metadata, canonical acquisition order, abortable waiting, stale reclaim,
 * and ONE ownership context shared with the legacy install-lock API (so
 * inner writers keep working inside an operation that holds install-state).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-operations-resources-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import {
  acquireResources,
  heldInContext,
  readResourceHolder,
  resourceLockPath,
  runHolding,
  sortResources,
  tryAcquireResources,
  type ResourceLease,
} from '@bakin/core/operations'
import {
  acquireInstallLock,
  assertInstallLockHeld,
  releaseInstallLock,
  withInstallLock,
} from '../../../src/core/install-core/install-lock'
import { settleFor, waitUntil } from '../../helpers/wait'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const identity = (operationId: string, title = `op ${operationId}`) => ({ bootId: 'boot-a', operationId, title })
const leases: ResourceLease[] = []

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})
afterEach(() => {
  for (const lease of leases.splice(0)) lease.release()
  try { releaseInstallLock() } catch { /* not held */ }
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

async function acquire(resources: string[], opts: Parameters<typeof acquireResources>[1]): Promise<ResourceLease> {
  const lease = await acquireResources(resources, opts)
  leases.push(lease)
  return lease
}

describe('resource paths and order', () => {
  it('maps install-state to the existing install.lock and the rest under locks/', () => {
    expect(resourceLockPath('install-state')).toBe(join(testDir, 'install.lock'))
    expect(resourceLockPath('media-store')).toBe(join(testDir, 'locks', 'media-store.lock'))
    expect(resourceLockPath('search-engine')).toBe(join(testDir, 'locks', 'search-engine.lock'))
    expect(resourceLockPath('voice:models')).toBe(join(testDir, 'locks', 'voice', 'models.lock'))
  })

  it('rejects names that are neither core nor <pluginId>:<name>', () => {
    for (const bad of ['', 'media', 'a:', ':b', '../x:y', 'A:b', 'x:y/z']) {
      expect(() => resourceLockPath(bad)).toThrow(/resource/)
    }
  })

  it('sorts core resources canonically, then plugin resources, without duplicates', () => {
    expect(sortResources(['zeta:b', 'search-engine', 'alpha:a', 'install-state', 'media-store', 'search-engine']))
      .toEqual(['install-state', 'media-store', 'search-engine', 'alpha:a', 'zeta:b'])
  })
})

describe('acquire and release', () => {
  it('writes holder metadata and acquires in canonical order regardless of the declared order', async () => {
    const lease = await acquire(['search-engine', 'install-state'], { identity: identity('op-1', 'Install media') })
    expect(lease.resources).toEqual(['install-state', 'search-engine'])
    const holder = JSON.parse(readFileSync(resourceLockPath('search-engine'), 'utf-8'))
    expect(holder).toEqual({ pid: process.pid, bootId: 'boot-a', operationId: 'op-1', title: 'Install media', acquiredAt: expect.any(String) })

    lease.release()
    lease.release()
    expect(existsSync(resourceLockPath('install-state'))).toBe(false)
    expect(existsSync(resourceLockPath('search-engine'))).toBe(false)
  })

  it('makes a second operation in this process wait visibly, then proceed after release', async () => {
    const first = await acquire(['media-store'], { identity: identity('op-1', 'Repair media') })
    const waits: Array<{ resource: string; title?: string }> = []
    let acquired = false
    const second = acquire(['media-store'], {
      identity: identity('op-2'),
      onWait: ({ resource, holder }) => waits.push({ resource, title: holder.title }),
      pollMs: { initial: 5, max: 20 },
    }).then((lease) => { acquired = true; return lease })

    await waitUntil(() => waits.length > 0, { label: 'second operation waiting' })
    expect(waits).toEqual([{ resource: 'media-store', title: 'Repair media' }])
    await settleFor(50, 'the holder has not released yet, so the waiter must not acquire')
    expect(acquired).toBe(false)

    first.release()
    const lease = await second
    expect(readResourceHolder('media-store')?.operationId).toBe('op-2')
    expect(lease.resources).toEqual(['media-store'])
  })

  it('aborts while waiting, holding nothing and leaving the holder untouched', async () => {
    await acquire(['search-engine'], { identity: identity('op-1') })
    const controller = new AbortController()
    let waiting = false
    const pending = acquireResources(['install-state', 'search-engine'], {
      identity: identity('op-2'),
      signal: controller.signal,
      onWait: () => { waiting = true },
      pollMs: { initial: 5, max: 20 },
    })
    await waitUntil(() => waiting, { label: 'waiting on search-engine' })
    controller.abort(new Error('user cancelled'))

    await expect(pending).rejects.toThrow('user cancelled')
    expect(existsSync(resourceLockPath('install-state'))).toBe(false)
    expect(readResourceHolder('search-engine')?.operationId).toBe('op-1')
  })

  it('never takes a lease when the abort races the holder release', async () => {
    const holder = await acquire(['media-store'], { identity: identity('op-1') })
    const controller = new AbortController()
    let waiting = false
    const pending = acquireResources(['media-store'], {
      identity: identity('op-2'),
      signal: controller.signal,
      onWait: () => { waiting = true },
      pollMs: { initial: 5, max: 20 },
    })
    await waitUntil(() => waiting, { label: 'waiting on media-store' })
    holder.release()
    controller.abort(new Error('late'))

    await expect(pending).rejects.toThrow('late')
    expect(existsSync(resourceLockPath('media-store'))).toBe(false)
  })

  it('refuses an already-aborted signal without creating any lock file', async () => {
    const controller = new AbortController()
    controller.abort(new Error('gone'))
    await expect(acquireResources(['media-store'], { identity: identity('op-1'), signal: controller.signal })).rejects.toThrow('gone')
    expect(existsSync(resourceLockPath('media-store'))).toBe(false)
  })

  it('reclaims a lock whose holder pid is dead, and reports the reclaim', async () => {
    mkdirSync(join(testDir, 'locks'), { recursive: true })
    writeFileSync(resourceLockPath('media-store'), JSON.stringify({ pid: 999_999, acquiredAt: '2026-01-01T00:00:00.000Z', title: 'Old repair' }))
    const reclaimed: string[] = []
    await acquire(['media-store'], { identity: identity('op-1'), onReclaim: ({ holder }) => reclaimed.push(holder.title ?? '') })
    expect(reclaimed).toEqual(['Old repair'])
    expect(readResourceHolder('media-store')?.operationId).toBe('op-1')
  })

  it('reclaims a lock naming this process that no live operation here holds', async () => {
    writeFileSync(resourceLockPath('install-state'), JSON.stringify({ pid: process.pid, bootId: 'boot-a', operationId: 'ghost', acquiredAt: new Date().toISOString() }))
    await acquire(['install-state'], { identity: identity('op-1') })
    expect(readResourceHolder('install-state')?.operationId).toBe('op-1')
  })

  it('tryAcquire never waits: it returns the busy holder or a lease', async () => {
    await acquire(['search-engine'], { identity: identity('op-1', 'Reindex') })
    const busy = tryAcquireResources(['search-engine'], identity('pump'))
    expect(busy).toEqual({ busy: { resource: 'search-engine', holder: expect.objectContaining({ title: 'Reindex' }) } })

    const lease = tryAcquireResources(['media-store'], identity('pump'))
    expect('release' in lease).toBe(true)
    if ('release' in lease) leases.push(lease)
  })

  it('tryAcquire releases what it took when a later resource is busy', async () => {
    await acquire(['search-engine'], { identity: identity('op-1') })
    expect('busy' in tryAcquireResources(['install-state', 'search-engine'], identity('op-2'))).toBe(true)
    expect(existsSync(resourceLockPath('install-state'))).toBe(false)
  })
})

describe('one ownership context', () => {
  it('is reentrant within the holding call chain and never waits on itself', async () => {
    const outer = await acquire(['install-state'], { identity: identity('op-1') })
    await runHolding(outer.resources, async () => {
      expect(heldInContext('install-state')).toBe(true)
      const inner = await acquire(['install-state', 'media-store'], { identity: identity('op-1') })
      expect(inner.resources).toEqual(['media-store'])
      await runHolding(inner.resources, async () => {
        expect(heldInContext('install-state')).toBe(true)
        expect(heldInContext('media-store')).toBe(true)
      })
    })
    expect(heldInContext('install-state')).toBe(false)
  })

  it('satisfies the legacy inner-writer assertion and reentrant withInstallLock inside an operation holding install-state', async () => {
    const lease = await acquire(['install-state'], { identity: identity('op-1') })
    let ran = false
    await runHolding(lease.resources, async () => {
      expect(() => assertInstallLockHeld('installManifestBins')).not.toThrow()
      await withInstallLock(async () => { ran = true })
    })
    expect(ran).toBe(true)
    expect(readResourceHolder('install-state')?.operationId).toBe('op-1')
    expect(() => assertInstallLockHeld('installManifestBins')).toThrow(/install lock/)
  })

  it('is reentrant for an operation started inside a legacy withInstallLock holder', async () => {
    await withInstallLock(async () => {
      const lease = await acquire(['install-state'], { identity: identity('op-1') })
      expect(lease.resources).toEqual([])
    })
  })

  it('blocks a new-API acquire while the legacy lock is held, and the legacy API while a lease is held', async () => {
    acquireInstallLock()
    let waiting = false
    const pending = acquire(['install-state'], { identity: identity('op-1'), onWait: () => { waiting = true }, pollMs: { initial: 5, max: 20 } })
    await waitUntil(() => waiting, { label: 'new API waiting on legacy holder' })
    releaseInstallLock()
    await pending

    expect(() => acquireInstallLock()).toThrow(/Another install is in progress/)
  })
})

describe('two processes', () => {
  it('waits for a live holder in another process and reclaims after it dies', async () => {
    const script = `
      import { acquireResources } from ${JSON.stringify(join(REPO_ROOT, 'packages/core/src/operations/resources.ts'))}
      await acquireResources(['media-store'], { identity: { title: 'Child repair', operationId: 'child' } })
      console.log('HELD')
      setInterval(() => {}, 1000)
    `
    const child = Bun.spawn(['bun', '-e', script], {
      cwd: REPO_ROOT,
      env: { ...process.env, BAKIN_HOME: testDir, BAKIN_CONSOLE_FORMAT: 'silent' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    try {
      const reader = child.stdout.getReader()
      let out = ''
      const deadline = Date.now() + 20_000
      while (!out.includes('HELD') && Date.now() < deadline) {
        const { value, done } = await reader.read()
        if (done) break
        out += new TextDecoder().decode(value)
      }
      expect(out).toContain('HELD')

      const waits: Array<number> = []
      const pending = acquire(['media-store'], { identity: identity('op-1'), onWait: ({ holder }) => waits.push(holder.pid), pollMs: { initial: 10, max: 50 } })
      await waitUntil(() => waits.length > 0, { label: 'parent waiting on child' })
      expect(waits[0]).toBe(child.pid)

      child.kill('SIGKILL')
      await child.exited
      await pending
      expect(readResourceHolder('media-store')?.operationId).toBe('op-1')
    } finally {
      child.kill('SIGKILL')
    }
  }, 30_000)
})
