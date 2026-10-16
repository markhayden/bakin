/**
 * Registry ↔ resources (#895 D7/D23): an operation acquires its declared
 * resources after the 202, shows `waitingFor` while blocked, can be
 * cancelled while waiting, re-validates after a wait, holds the resources
 * for its whole run (inner writers can assert it) and releases on settle.
 * `runLocal` runs the same machinery in-process and returns the terminal view.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-operations-registry-resources-${Date.now()}-${randomUUID()}`)
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
  createOperationRegistry,
  readResourceHolder,
  resourceLockPath,
  runLocal,
  type OperationContext,
  type OperationOutcome,
  type OperationRegistry,
  type OperationView,
  type StartOperationInput,
} from '@bakin/core/operations'
import { assertInstallLockHeld, withInstallLock } from '../../../src/core/install-core/install-lock'
import { waitUntil } from '../../helpers/wait'

const registries: OperationRegistry[] = []
beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})
afterEach(() => { for (const r of registries.splice(0)) r.dispose() })
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

function makeRegistry(published: OperationView[] = []): OperationRegistry {
  const registry = createOperationRegistry({
    bootId: () => 'boot-a',
    publish: (view) => published.push(view),
    quietCheckIntervalMs: 0,
    tickIntervalMs: 10,
    resourcePollMs: { initial: 5, max: 20 },
  })
  registries.push(registry)
  return registry
}

function deferred<T = void>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

const ok = <B,>(body: B): OperationOutcome<B> => ({ status: 'succeeded', code: 'ok', httpStatus: 200, body })

function input(over: Partial<StartOperationInput> = {}): StartOperationInput {
  return {
    kind: 'install',
    owner: 'core',
    origin: 'web',
    title: 'Install A',
    fingerprint: `install:${randomUUID()}`,
    resources: ['install-state'],
    plan: {
      stages: [
        { id: 'fetch', kind: 'downloading', label: 'Fetch' },
        { id: 'place', kind: 'installing', label: 'Place' },
      ],
      pointOfNoReturn: 'place',
    },
    run: async () => ok(null),
    ...over,
  }
}

describe('registry acquires declared resources', () => {
  it('holds them for the whole run, visible to inner writers, and releases on settle', async () => {
    const registry = makeRegistry()
    let seen: { holds: boolean; holder?: string; assertOk: boolean } | undefined
    const { operationId } = await registry.start(input({
      resources: ['media-store', 'install-state'],
      run: async (op) => {
        let assertOk = true
        try { assertInstallLockHeld('test writer') } catch { assertOk = false }
        seen = { holds: op.holds('install-state') && op.holds('media-store'), holder: readResourceHolder('media-store')?.operationId, assertOk }
        return ok(null)
      },
    }))
    const view = await registry.await(operationId)
    expect(view.status).toBe('succeeded')
    expect(view.resources).toEqual(['install-state', 'media-store'])
    expect(seen).toEqual({ holds: true, holder: operationId, assertOk: true })
    expect(existsSync(resourceLockPath('install-state'))).toBe(false)
    expect(existsSync(resourceLockPath('media-store'))).toBe(false)
  })

  it('makes a different request wait visibly with the holder named, then run', async () => {
    const registry = makeRegistry()
    const gate = deferred()
    const a = await registry.start(input({ title: 'Install A', run: async () => { await gate.promise; return ok('a') } }))
    let bRan = false
    const b = await registry.start(input({ title: 'Install B', run: async () => { bRan = true; return ok('b') } }))

    await waitUntil(() => registry.get(b.operationId)?.waitingFor !== undefined, { label: 'B waiting' })
    const waiting = registry.get(b.operationId)!
    expect(waiting.status).toBe('running')
    expect(waiting.waitingFor).toEqual({ holderTitle: 'Install A', holderOperationId: a.operationId, since: expect.any(String) })
    expect(waiting.cancellable).toBe(true)
    expect(bRan).toBe(false)

    gate.resolve()
    const done = await registry.await(b.operationId)
    expect(done.status).toBe('succeeded')
    expect(done.waitingFor).toBeUndefined()
    expect(bRan).toBe(true)
  })

  it('cancels while waiting without running and without touching the holder', async () => {
    const registry = makeRegistry()
    const gate = deferred()
    const a = await registry.start(input({ run: async () => { await gate.promise; return ok(null) } }))
    let bRan = false
    const b = await registry.start(input({ title: 'Install B', run: async () => { bRan = true; return ok(null) } }))
    await waitUntil(() => registry.get(b.operationId)?.waitingFor !== undefined, { label: 'B waiting' })

    expect(registry.cancel(b.operationId)).toBe('cancelling')
    const view = await registry.await(b.operationId)
    expect(view.status).toBe('cancelled')
    expect(bRan).toBe(false)
    expect(readResourceHolder('install-state')?.operationId).toBe(a.operationId)
    gate.resolve()
    await registry.await(a.operationId)
  })

  it('re-validates after a wait and finishes with the revalidation outcome', async () => {
    const registry = makeRegistry()
    const gate = deferred()
    await registry.start(input({ run: async () => { await gate.promise; return ok(null) } }))
    let ran = false
    const b = await registry.start(input({
      revalidate: async () => ({ status: 'failed', code: 'already_installed', httpStatus: 409, body: { error: 'installed meanwhile' } }),
      run: async () => { ran = true; return ok(null) },
    }))
    await waitUntil(() => registry.get(b.operationId)?.waitingFor !== undefined, { label: 'B waiting' })
    gate.resolve()

    const view = await registry.await(b.operationId)
    expect(view.status).toBe('failed')
    expect(view.outcome?.code).toBe('already_installed')
    expect(view.result).toEqual({ httpStatus: 409, body: { error: 'installed meanwhile' } })
    expect(ran).toBe(false)
    expect(existsSync(resourceLockPath('install-state'))).toBe(false)
  })

  it('skips revalidation when nothing was waited for', async () => {
    const registry = makeRegistry()
    let revalidated = false
    const { operationId } = await registry.start(input({ revalidate: async () => { revalidated = true } }))
    await registry.await(operationId)
    expect(revalidated).toBe(false)
  })

  it('releases its resources when run throws', async () => {
    const registry = makeRegistry()
    const { operationId } = await registry.start(input({ run: async () => { throw new Error('boom') } }))
    expect((await registry.await(operationId)).outcome?.code).toBe('unexpected')
    expect(existsSync(resourceLockPath('install-state'))).toBe(false)
  })
})

describe('runLocal', () => {
  const steps = (op: OperationContext) => {
    op.stage('fetch')
    op.item('fetch', { id: 'x', label: 'x', status: 'done' })
    op.stage('place')
  }
  const shape = (views: OperationView[]) => views.map((v) => ({ status: v.status, stages: v.stages.map((s) => s.status), waiting: Boolean(v.waitingFor) }))

  it('produces the same view sequence as the server path and returns the terminal view', async () => {
    const serverViews: OperationView[] = []
    const server = makeRegistry(serverViews)
    const started = await server.start(input({ run: async (op) => { steps(op); return ok('body') } }))
    await server.await(started.operationId)

    const localViews: OperationView[] = []
    const local = makeRegistry(localViews)
    const view = await runLocal(local, input({ run: async (op) => { steps(op); return ok('body') } }))

    expect(view.status).toBe('succeeded')
    expect(view.result).toEqual({ httpStatus: 200, body: 'body' })
    await waitUntil(() => localViews.at(-1)?.status === 'succeeded' && serverViews.at(-1)?.status === 'succeeded', { label: 'both terminal' })
    expect(shape(localViews)).toEqual(shape(serverViews))
  })

  it('rethrows a validation failure without registering anything', async () => {
    const registry = makeRegistry()
    await expect(runLocal(registry, input({ validate: () => { throw new Error('invalid') } }))).rejects.toThrow('invalid')
    expect(registry.list()).toEqual([])
  })

  it('is reentrant inside an existing withInstallLock holder and never waits on itself', async () => {
    const registry = makeRegistry()
    const view = await withInstallLock(() => runLocal(registry, input({
      run: async (op) => {
        assertInstallLockHeld('nested writer')
        return ok(op.holds('install-state'))
      },
    })))
    expect(view.status).toBe('succeeded')
    expect(view.waitingFor).toBeUndefined()
    expect(view.result?.body).toBe(true)
  })
})
