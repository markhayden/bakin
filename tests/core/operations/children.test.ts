/**
 * Children (#895 D10, D21, D22): the precedence table, startChild (identity,
 * own resources, sequential runs), the parent latch, cancel cascade with the
 * parent settling last, progress aggregation, the audit child summary and
 * eviction with the parent.
 */
import { afterAll, mock } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-operations-children-${Date.now()}-${randomUUID()}`)
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
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

import { afterEach, describe, expect, it } from 'bun:test'

import {
  CHILD_SKIPPED_CODE,
  createMemoryResourceAcquirer,
  createOperationRegistry,
  OperationCancelledError,
  parentOutcome,
  tallyChildren,
  type ChildOperationInput,
  type OperationContext,
  type OperationOutcome,
  type OperationRegistry,
  type OperationView,
  type StartOperationInput,
} from '@bakin/core/operations'

const registries: OperationRegistry[] = []
afterEach(() => { for (const r of registries.splice(0)) r.dispose() })

function deferred<T = void>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

function harness(opts: { finishedTtlMs?: number; maxFinished?: number } = {}) {
  let now = Date.parse('2026-10-16T00:00:00.000Z')
  const published: OperationView[] = []
  const audits: Array<{ event: string; data: Record<string, unknown> }> = []
  const registry = createOperationRegistry({
    bootId: () => 'boot-a',
    now: () => now,
    publish: (view) => published.push(view),
    audit: (event, data) => audits.push({ event, data }),
    quietCheckIntervalMs: 0,
    tickIntervalMs: 0,
    acquireResources: createMemoryResourceAcquirer(2),
    ...opts,
  })
  registries.push(registry)
  return { registry, published, audits, advance: (ms: number) => { now += ms } }
}

const ok = <B,>(body: B, code = 'ok'): OperationOutcome<B> => ({ status: 'succeeded', code, httpStatus: 200, body })

function parentInput(run: StartOperationInput['run'], over: Partial<StartOperationInput> = {}): StartOperationInput {
  return {
    kind: 'repair',
    owner: 'core',
    origin: 'web',
    title: 'Apply repairs',
    href: '/health',
    fingerprint: `repair:${randomUUID()}`,
    plan: { stages: [{ id: 'children', kind: 'installing', label: 'Apply repairs' }, { id: 'verify', kind: 'verifying', label: 'Re-check' }], pointOfNoReturn: null },
    run,
    ...over,
  }
}

function child(over: Partial<ChildOperationInput> = {}): ChildOperationInput {
  return {
    kind: 'repair:x',
    title: 'Child',
    fingerprint: randomUUID(),
    plan: { stages: [{ id: 'prep', kind: 'preparing', label: 'Prepare' }, { id: 'apply', kind: 'installing', label: 'Apply' }], pointOfNoReturn: 'apply' },
    run: async (op) => { op.stage('prep'); op.stage('apply'); return ok(null) },
    ...over,
  }
}

describe('parent outcome precedence (first match wins)', () => {
  const tally = (applied: number, skipped: number, failed: number, cancelled: number) => ({ applied, skipped, failed, cancelled })
  const rows: Array<[string, ReturnType<typeof tally>, { cancelled: boolean; verified: boolean | null }, string, string]> = [
    ['1 cancelled before anything applied', tally(0, 1, 0, 1), { cancelled: true, verified: null }, 'cancelled', 'cancelled'],
    ['2 applied plus failed', tally(1, 0, 1, 0), { cancelled: false, verified: true }, 'failed', 'partially_applied'],
    ['2 applied plus cancelled (parent cancelled after an apply)', tally(1, 0, 0, 1), { cancelled: true, verified: null }, 'failed', 'partially_applied'],
    ['3 every child that ran failed', tally(0, 2, 2, 0), { cancelled: false, verified: true }, 'failed', 'apply_failed'],
    ['4 every child skipped', tally(0, 3, 0, 0), { cancelled: false, verified: false }, 'succeeded', 'nothing_applied'],
    ['4 no children at all', tally(0, 0, 0, 0), { cancelled: false, verified: true }, 'succeeded', 'nothing_applied'],
    ['5 applied, verification failed', tally(2, 1, 0, 0), { cancelled: false, verified: false }, 'failed', 'verification_failed'],
    ['6 applied and verified', tally(2, 1, 0, 0), { cancelled: false, verified: true }, 'succeeded', 'ok'],
    ['6 applied, verification not run', tally(1, 0, 0, 0), { cancelled: false, verified: null }, 'succeeded', 'ok'],
  ]
  for (const [name, t, opts, status, code] of rows) {
    it(name, () => expect(parentOutcome(t, opts)).toEqual({ status, code } as never))
  }

  it('tallies settled children by how they ended', () => {
    expect(tallyChildren([
      { status: 'succeeded', outcome: { code: 'ok' } },
      { status: 'succeeded', outcome: { code: CHILD_SKIPPED_CODE } },
      { status: 'failed', outcome: { code: 'unexpected' } },
      { status: 'cancelled', outcome: { code: 'cancelled' } },
      { status: 'running' },
    ])).toEqual({ applied: 1, skipped: 1, failed: 1, cancelled: 1 })
  })
})

describe('startChild', () => {
  it('runs children sequentially with the parent identity, their own resources, and a namespaced fingerprint', async () => {
    const { registry } = harness()
    const order: string[] = []
    const seen: Array<{ holdsMedia: boolean; parentHoldsMedia?: boolean }> = []
    let parentCtx!: OperationContext
    const { operationId } = await registry.start(parentInput(async (op) => {
      parentCtx = op
      op.stage('children')
      const a = await registry.startChild(op.id, child({
        title: 'Install media store',
        resources: ['media-store'],
        run: async (c) => {
          order.push('a:start')
          seen.push({ holdsMedia: c.holds('media-store'), parentHoldsMedia: parentCtx.holds('media-store') })
          c.stage('prep'); c.stage('apply')
          order.push('a:end')
          return ok('a')
        },
      }))
      const b = await registry.startChild(op.id, child({
        title: 'Sync agents',
        run: async (c) => { order.push('b:start'); c.stage('prep'); return ok(null, CHILD_SKIPPED_CODE) },
      }))
      op.stage('verify')
      const outcome = parentOutcome(tallyChildren([a, b]), { cancelled: false, verified: true })
      return { ...outcome, status: outcome.status as 'succeeded', httpStatus: 200, body: { rows: [a.result?.body, b.outcome?.code] } }
    }, { origin: 'cli' }))

    const parent = await registry.await(operationId)
    expect(order).toEqual(['a:start', 'a:end', 'b:start'])
    expect(seen).toEqual([{ holdsMedia: true, parentHoldsMedia: false }])
    expect(parent.status).toBe('succeeded')
    expect(parent.outcome?.code).toBe('ok')
    expect(parent.result?.body).toEqual({ rows: ['a', CHILD_SKIPPED_CODE] })
    expect(parent.children).toHaveLength(2)

    const first = registry.get(parent.children[0]!)!
    expect(first).toMatchObject({ parentId: operationId, owner: 'core', origin: 'cli', href: '/health', resources: ['media-store'], status: 'succeeded' })
    expect(first.fingerprint.startsWith(`${parent.fingerprint}/`)).toBe(true)
    // Children never list on their own.
    expect(registry.list().map((v) => v.id)).toEqual([operationId])
  })

  it('latches the parent non-cancellable once a child passes its point of no return', async () => {
    const { registry } = harness()
    const inApply = deferred()
    const release = deferred()
    const { operationId } = await registry.start(parentInput(async (op) => {
      op.stage('children')
      await registry.startChild(op.id, child({ run: async (c) => { c.stage('prep'); c.stage('apply'); inApply.resolve(); await release.promise; return ok(null) } }))
      return ok(null)
    }))
    expect(registry.get(operationId)!.cancellable).toBe(true)
    await inApply.promise
    expect(registry.get(operationId)!.cancellable).toBe(false)
    expect(registry.cancel(operationId)).toBe('not_cancellable')
    release.resolve()
    expect((await registry.await(operationId)).status).toBe('succeeded')
  })

  it('latches immediately for a child that is never cancellable', async () => {
    const { registry } = harness()
    const release = deferred()
    const started = deferred()
    const { operationId } = await registry.start(parentInput(async (op) => {
      await registry.startChild(op.id, child({ plan: { stages: [{ id: 'apply', kind: 'installing', label: 'Apply' }], pointOfNoReturn: 'start' }, run: async () => { started.resolve(); await release.promise; return ok(null) } }))
      return ok(null)
    }))
    await started.promise
    expect(registry.get(operationId)!.cancellable).toBe(false)
    release.resolve()
    await registry.await(operationId)
  })

  it('cascades cancel to a running child and settles the parent only after the child', async () => {
    const { registry, published } = harness()
    const childRunning = deferred()
    let secondStarted = false
    const { operationId } = await registry.start(parentInput(async (op) => {
      op.stage('children')
      const first = await registry.startChild(op.id, child({
        run: async (c) => {
          c.stage('prep')
          childRunning.resolve()
          await new Promise<void>((resolve) => c.signal.addEventListener('abort', () => resolve()))
          // A slow stop: the parent must not report cancelled before this settles.
          await new Promise((r) => setTimeout(r, 20))
          c.throwIfCancelled()
          return ok(null)
        },
      }))
      expect(first.status).toBe('cancelled')
      await registry.startChild(op.id, child({ run: async () => { secondStarted = true; return ok(null) } }))
      return ok(null)
    }))
    await childRunning.promise
    expect(registry.cancel(operationId)).toBe('cancelling')

    const parent = await registry.await(operationId)
    expect(parent.status).toBe('cancelled')
    expect(secondStarted).toBe(false)
    expect(parent.children).toHaveLength(1)

    const childId = parent.children[0]!
    const childTerminal = published.findIndex((v) => v.id === childId && v.status === 'cancelled')
    const parentTerminal = published.findIndex((v) => v.id === operationId && v.status === 'cancelled')
    expect(childTerminal).toBeGreaterThanOrEqual(0)
    expect(parentTerminal).toBeGreaterThan(childTerminal)
  })

  it('settles the parent after a child it did not await', async () => {
    const { registry, published } = harness()
    const release = deferred()
    const { operationId } = await registry.start(parentInput(async (op) => {
      void registry.startChild(op.id, child({ run: async (c) => { c.stage('prep'); await release.promise; return ok(null) } }))
      return ok(null)
    }))
    setTimeout(() => release.resolve(), 20)
    const parent = await registry.await(operationId)
    const childId = parent.children[0]!
    expect(registry.get(childId)!.status).toBe('succeeded')
    const childTerminal = published.findIndex((v) => v.id === childId && v.status === 'succeeded')
    const parentTerminal = published.findIndex((v) => v.id === operationId && v.status === 'succeeded')
    expect(parentTerminal).toBeGreaterThan(childTerminal)
  })

  it('refuses a new child once the parent has a pending cancel', async () => {
    const { registry } = harness()
    const gate = deferred()
    let refusal: unknown
    const { operationId } = await registry.start(parentInput(async (op) => {
      await gate.promise
      try { await registry.startChild(op.id, child()) } catch (err) { refusal = err; throw err }
      return ok(null)
    }))
    registry.cancel(operationId)
    gate.resolve()
    expect((await registry.await(operationId)).status).toBe('cancelled')
    expect(refusal).toBeInstanceOf(OperationCancelledError)
  })

  it('aggregates child progress and liveness into the parent clocks', async () => {
    const { registry, advance } = harness()
    const progressed = deferred()
    const done = deferred()
    const { operationId } = await registry.start(parentInput(async (op) => {
      op.stage('children')
      await registry.startChild(op.id, child({
        plan: { stages: [{ id: 'dl', kind: 'downloading', label: 'Download' }], pointOfNoReturn: null },
        run: async (c) => {
          c.stage('dl')
          advance(5_000)
          c.bytes('dl', { received: 10, total: 100 })
          advance(5_000)
          c.output('still here')
          progressed.resolve()
          await done.promise
          return ok(null)
        },
      }))
      return ok(null)
    }))
    await progressed.promise
    const parent = registry.get(operationId)!
    const startedAt = Date.parse(parent.startedAt)
    expect(Date.parse(parent.lastProgressAt) - startedAt).toBe(5_000)
    expect(Date.parse(parent.lastLivenessAt) - startedAt).toBe(10_000)
    done.resolve()
    await registry.await(operationId)
  })

  it('audits the parent once with a child summary and never audits children', async () => {
    const { registry, audits } = harness()
    const { operationId } = await registry.start(parentInput(async (op) => {
      const a = await registry.startChild(op.id, child())
      const b = await registry.startChild(op.id, child({ run: async () => { throw new Error('boom') } }))
      const outcome = parentOutcome(tallyChildren([a, b]), { cancelled: false, verified: null })
      return { status: outcome.status as 'failed', code: outcome.code, httpStatus: 200, body: null }
    }))
    const parent = await registry.await(operationId)
    expect(parent.outcome).toEqual({ code: 'partially_applied', partiallyApplied: true })
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ event: 'operation.failed', data: { operationId, code: 'partially_applied', children: { applied: 1, skipped: 0, failed: 1, cancelled: 0 } } })
  })

  it('evicts children together with their parent', async () => {
    const { registry, advance } = harness({ finishedTtlMs: 1_000 })
    const { operationId } = await registry.start(parentInput(async (op) => {
      await registry.startChild(op.id, child())
      return ok(null)
    }))
    const parent = await registry.await(operationId)
    const childId = parent.children[0]!
    expect(registry.get(childId)).not.toBeNull()
    advance(2_000)
    registry.list()
    expect(registry.get(operationId)).toBeNull()
    expect(registry.get(childId)).toBeNull()
  })

  it('rejects a child for an unknown or finished parent', async () => {
    const { registry } = harness()
    await expect(registry.startChild('nope', child())).rejects.toThrow('Unknown operation')
    const { operationId } = await registry.start(parentInput(async () => ok(null)))
    await registry.await(operationId)
    await expect(registry.startChild(operationId, child())).rejects.toThrow('already finished')
  })
})

describe('early rejection', () => {
  it('a validation failure publishes nothing and audits nothing', async () => {
    const { registry, published, audits } = harness()
    await expect(registry.start(parentInput(async () => ok(null), { validate: () => { throw new Error('nothing selected') } }))).rejects.toThrow('nothing selected')
    expect(published).toEqual([])
    expect(audits).toEqual([])
    expect(registry.list()).toEqual([])
  })
})
