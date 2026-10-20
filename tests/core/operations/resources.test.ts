/**
 * Operation resources (D23): one O_EXCL lock file per resource with holder
 * metadata, canonical acquisition order, abortable waiting, stale reclaim,
 * and ONE ownership context shared with the legacy install-lock API (so
 * inner writers keep working inside an operation that holds install-state).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
  assertResourceHeld,
  heldInContext,
  holdNow,
  readResourceHolder,
  resourceLockPath,
  runHolding,
  sortResources,
  tryAcquireResources,
  ResourceBusyError,
  type ResourceLease,
} from '@bakin/core/operations'
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

  it('inner writers assert ownership: satisfied only inside the holding call chain, naming the writer outside it', async () => {
    const lease = await acquire(['install-state'], { identity: identity('op-1') })
    await runHolding(lease.resources, async () => {
      expect(() => assertResourceHeld('install-state', 'installManifestBins')).not.toThrow()
    })
    expect(readResourceHolder('install-state')?.operationId).toBe('op-1')
    expect(() => assertResourceHeld('install-state', 'installManifestBins')).toThrow(/installManifestBins requires install-state/)
  })
})

describe('holdNow — the bounded synchronous writers', () => {
  it('takes the resource for the call and releases it after, satisfying inner writers', async () => {
    let inside = false
    await holdNow(['install-state'], { title: 'Toggle lesson' }, async () => {
      assertResourceHeld('install-state', 'lesson toggle')
      inside = readResourceHolder('install-state')?.title === 'Toggle lesson'
    })
    expect(inside).toBe(true)
    expect(existsSync(resourceLockPath('install-state'))).toBe(false)
  })

  it('never waits: a held resource throws ResourceBusyError naming the holder, and the body never runs', async () => {
    await acquire(['install-state'], { identity: identity('op-1', 'Install plugin notes') })
    let ran = false
    const busy = await holdNow(['install-state'], { title: 'Unlink' }, async () => { ran = true }).catch((err: unknown) => err)
    expect(busy).toBeInstanceOf(ResourceBusyError)
    expect((busy as ResourceBusyError).holder.title).toBe('Install plugin notes')
    expect(ran).toBe(false)
  })

  it('is reentrant inside an operation that already holds the resource', async () => {
    const lease = await acquire(['install-state'], { identity: identity('op-1') })
    let ran = false
    await runHolding(lease.resources, () => holdNow(['install-state'], { title: 'nested' }, async () => { ran = true }))
    expect(ran).toBe(true)
    expect(readResourceHolder('install-state')?.operationId).toBe('op-1')
  })

  it('never takes over a lock another live process holds', async () => {
    const path = resourceLockPath('install-state')
    mkdirSync(dirname(path), { recursive: true })
    const foreign = { pid: process.ppid, acquiredAt: new Date().toISOString(), title: 'Another Bakin' }
    writeFileSync(path, JSON.stringify(foreign))
    const busy = await holdNow(['install-state'], { title: 'Unlink' }, async () => {}).catch((err: unknown) => err)
    expect(busy).toBeInstanceOf(ResourceBusyError)
    expect(JSON.parse(readFileSync(path, 'utf-8')).pid).toBe(process.ppid)
  })
})

describe('stale-lock reclaim is single-winner (#896 D3.5)', () => {
  it('a reclaim marker left by a dead reclaimer is ignored after its grace', async () => {
    const path = resourceLockPath('media-store')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ pid: 2 ** 22 + 7, acquiredAt: '2026-01-01T00:00:00.000Z', title: 'dead' }))
    const marker = `${path}.reclaim`
    writeFileSync(marker, '')
    const old = new Date(Date.now() - 60_000)
    utimesSync(marker, old, old)
    const lease = await acquire(['media-store'], { identity: identity('op-reclaim'), pollMs: { initial: 10, max: 50 } })
    expect(readResourceHolder('media-store')?.operationId).toBe('op-reclaim')
    expect(existsSync(marker)).toBe(false)
    lease.release()
  })

  it('a FRESH reclaim marker makes a contender wait for the reclaimer instead of unlinking its lock', async () => {
    const path = resourceLockPath('media-store')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ pid: 2 ** 22 + 7, acquiredAt: '2026-01-01T00:00:00.000Z', title: 'dead' }))
    const marker = `${path}.reclaim`
    writeFileSync(marker, '')
    let acquired = false
    const pending = acquire(['media-store'], { identity: identity('op-late'), pollMs: { initial: 10, max: 50 } }).then((lease) => { acquired = true; return lease })
    await settleFor(150, 'the contender must stay parked while a live reclaim marker exists')
    expect(acquired).toBe(false)
    // The reclaimer (a live foreign process) finishes: it swaps in its own
    // lock and drops the marker — the contender now waits on a LIVE holder.
    writeFileSync(path, JSON.stringify({ pid: process.ppid, operationId: 'op-winner', acquiredAt: new Date().toISOString(), title: 'winner' }))
    unlinkSync(marker)
    await settleFor(150, 'a live winner is never reclaimed')
    expect(acquired).toBe(false)
    unlinkSync(path) // the winner releases
    const lease = await pending
    expect(readResourceHolder('media-store')?.operationId).toBe('op-late')
    lease.release()
  })
})

describe('reclaim never touches a fresh lock (#896 review)', () => {
  it('a fresh EMPTY lock file (a contender between its open and its write) is never reclaimed', async () => {
    const path = resourceLockPath('media-store')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, '')
    const busy = await holdNow(['media-store'], { title: 'contender' }, async () => {}).catch((err: unknown) => err)
    expect(busy).toBeInstanceOf(ResourceBusyError)
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf-8')).toBe('')
  })

  it('a reclaim marker whose owner pid is DEAD is taken over at once; one whose owner is alive is waited for', async () => {
    const path = resourceLockPath('media-store')
    mkdirSync(dirname(path), { recursive: true })
    const stale = JSON.stringify({ pid: 2 ** 22 + 7, acquiredAt: '2026-01-01T00:00:00.000Z', title: 'dead' })
    const marker = `${path}.reclaim`
    writeFileSync(path, stale)
    writeFileSync(marker, JSON.stringify({ pid: 2 ** 22 + 9, at: new Date().toISOString() })) // fresh, but its owner is gone
    const lease = await acquire(['media-store'], { identity: identity('op-takeover'), pollMs: { initial: 10, max: 50 } })
    expect(readResourceHolder('media-store')?.operationId).toBe('op-takeover')
    expect(existsSync(marker)).toBe(false)
    lease.release()

    writeFileSync(path, stale)
    writeFileSync(marker, JSON.stringify({ pid: process.ppid, at: new Date().toISOString() })) // fresh AND alive
    let acquired = false
    const pending = acquire(['media-store'], { identity: identity('op-polite'), pollMs: { initial: 10, max: 50 } }).then((l) => { acquired = true; return l })
    await settleFor(150, 'a live reclaimer is never taken over inside the grace')
    expect(acquired).toBe(false)
    unlinkSync(marker)
    unlinkSync(path)
    ;(await pending).release()
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

  it('two processes racing the same dead-pid lock: exactly one reclaims, the other holds only after it released (#896 D3.5)', async () => {
    const path = resourceLockPath('media-store')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ pid: 2 ** 22 + 7, acquiredAt: '2026-01-01T00:00:00.000Z', title: 'dead' }))
    const go = join(testDir, 'go')
    // Both children inspect the stale lock as close to simultaneously as the
    // OS allows: each reports READY, then busy-waits on the barrier file.
    const script = (name: string) => `
      import { existsSync } from 'node:fs'
      import { acquireResources } from ${JSON.stringify(join(REPO_ROOT, 'packages/core/src/operations/resources.ts'))}
      console.log('READY')
      while (!existsSync(${JSON.stringify(go)})) Bun.sleepSync(1)
      const lease = await acquireResources(['media-store'], { identity: { title: ${JSON.stringify(name)}, operationId: ${JSON.stringify(name)} }, pollMs: { initial: 2, max: 10 } })
      console.log('ACQUIRED ' + ${JSON.stringify(name)} + ' ' + Date.now())
      await new Promise((resolve) => setTimeout(resolve, 600))
      lease.release()
      console.log('RELEASED ' + ${JSON.stringify(name)} + ' ' + Date.now())
    `
    const spawn = (name: string) => Bun.spawn(['bun', '-e', script(name)], {
      cwd: REPO_ROOT,
      env: { ...process.env, BAKIN_HOME: testDir, BAKIN_CONSOLE_FORMAT: 'silent' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const children = [spawn('child-a'), spawn('child-b')]
    const readers = children.map((child) => child.stdout.getReader())
    const outputs = ['', '']
    const readUntil = async (i: number, marker: string) => {
      const deadline = Date.now() + 20_000
      while (!outputs[i]!.includes(marker) && Date.now() < deadline) {
        const { value, done } = await readers[i]!.read()
        if (done) break
        outputs[i] += new TextDecoder().decode(value)
      }
    }
    try {
      await Promise.all([readUntil(0, 'READY'), readUntil(1, 'READY')])
      writeFileSync(go, '')
      await Promise.all([readUntil(0, 'RELEASED'), readUntil(1, 'RELEASED')])
      await Promise.all(children.map((child) => child.exited))
      const intervals = outputs.map((out) => ({
        acquired: Number(/ACQUIRED \S+ (\d+)/.exec(out)?.[1]),
        released: Number(/RELEASED \S+ (\d+)/.exec(out)?.[1]),
      })).sort((x, y) => x.acquired - y.acquired)
      expect(intervals.every((i) => Number.isFinite(i.acquired) && Number.isFinite(i.released))).toBe(true)
      // Disjoint holds: the second acquisition happens only after the first release.
      expect(intervals[1]!.acquired).toBeGreaterThanOrEqual(intervals[0]!.released)
      expect(existsSync(`${path}.reclaim`)).toBe(false)
      expect(existsSync(path)).toBe(false)
    } finally {
      for (const child of children) child.kill('SIGKILL')
    }
  }, 30_000)
})
