import { afterAll, mock } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-operations-registry-${Date.now()}-${randomUUID()}`)
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
  createOperationRegistry,
  OperationCancelledError,
  operationQuietState,
  type OperationContext,
  type OperationOutcome,
  type OperationPlan,
  type OperationRegistry,
  type OperationRegistryDeps,
  type OperationView,
  type StartOperationInput,
} from '@bakin/core/operations'
import { waitUntil } from '../../helpers/wait'

const T0 = Date.parse('2026-10-16T00:00:00.000Z')

interface Harness {
  registry: OperationRegistry
  published: Array<{ view: OperationView; kind: 'milestone' | 'tick' }>
  audits: Array<{ event: string; data: Record<string, unknown> }>
  advance(ms: number): void
}

const registries: OperationRegistry[] = []
afterEach(() => {
  for (const r of registries.splice(0)) r.dispose()
})

function harness(overrides: Partial<OperationRegistryDeps> = {}): Harness {
  let now = T0
  const published: Harness['published'] = []
  const audits: Harness['audits'] = []
  const registry = createOperationRegistry({
    bootId: () => 'boot-a',
    now: () => now,
    publish: (view, kind) => published.push({ view, kind }),
    audit: (event, data) => audits.push({ event, data }),
    tickIntervalMs: 40,
    quietCheckIntervalMs: 0,
    ...overrides,
  })
  registries.push(registry)
  return { registry, published, audits, advance: (ms) => { now += ms } }
}

const PLAN: OperationPlan = {
  stages: [
    { id: 'download', kind: 'downloading', label: 'Download' },
    { id: 'commit', kind: 'committing', label: 'Commit' },
  ],
  pointOfNoReturn: 'commit',
}

function deferred<T = void>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const ok = <B,>(body: B): OperationOutcome<B> => ({ status: 'succeeded', code: 'ok', httpStatus: 200, body })

function input(over: Partial<StartOperationInput> = {}): StartOperationInput {
  return {
    kind: 'install',
    owner: 'core',
    origin: 'web',
    title: 'Install thing',
    fingerprint: 'install:thing',
    plan: PLAN,
    run: async () => ok({ installed: true }),
    ...over,
  }
}

describe('operation registry — lifecycle', () => {
  it('returns the operation id and boot id, runs, and settles to the outcome', async () => {
    const { registry } = harness()
    const started = await registry.start(input())
    expect(started).toEqual({ operationId: expect.any(String), bootId: 'boot-a' })

    const view = await registry.await(started.operationId)
    expect(view.status).toBe('succeeded')
    expect(view.outcome).toEqual({ code: 'ok' })
    expect(view.result).toEqual({ httpStatus: 200, body: { installed: true } })
    expect(view.endedAt).toBeString()
  })

  it('attaches an identical request to the live operation instead of starting another', async () => {
    const { registry } = harness()
    const gate = deferred()
    let runs = 0
    const first = await registry.start(input({ run: async () => { runs++; await gate.promise; return ok(null) } }))
    const second = await registry.start(input({ run: async () => { runs++; return ok(null) } }))

    expect(second).toEqual({ operationId: first.operationId, bootId: 'boot-a', attached: true })
    gate.resolve()
    await registry.await(first.operationId)
    expect(runs).toBe(1)
  })

  it('starts a fresh operation for the same fingerprint once the first has finished', async () => {
    const { registry } = harness()
    const first = await registry.start(input())
    await registry.await(first.operationId)
    const second = await registry.start(input())
    expect(second.operationId).not.toBe(first.operationId)
    expect(second.attached).toBeUndefined()
  })

  it('unregisters on a validation failure and rethrows the validation error to every caller', async () => {
    const { registry, published } = harness()
    const gate = deferred()
    const rejection = new Error('bad request')
    const first = registry.start(input({ validate: async () => { await gate.promise; throw rejection } }))
    const attached = registry.start(input())
    gate.resolve()

    const settled = await Promise.allSettled([first, attached])
    expect(settled).toEqual([
      { status: 'rejected', reason: rejection },
      { status: 'rejected', reason: rejection },
    ])
    expect(registry.list()).toEqual([])
    expect(published).toEqual([])

    const retry = await registry.start(input())
    expect((await registry.await(retry.operationId)).status).toBe('succeeded')
  })

  it('maps a thrown error to failed / unexpected with a 500 body', async () => {
    const { registry } = harness()
    const { operationId } = await registry.start(input({ run: async () => { throw new Error('disk full') } }))
    const view = await registry.await(operationId)
    expect(view.status).toBe('failed')
    expect(view.outcome).toEqual({ code: 'unexpected', message: 'disk full' })
    expect(view.result).toEqual({ httpStatus: 500, body: { error: 'disk full' } })
  })

  it('records a failed outcome with its own status and body, and fails the active stage', async () => {
    const { registry } = harness()
    const { operationId } = await registry.start(input({
      run: async (op) => {
        op.stage('download')
        return { status: 'failed', code: 'collision', message: 'already installed', httpStatus: 409, body: { error: 'exists' } }
      },
    }))
    const view = await registry.await(operationId)
    expect(view.status).toBe('failed')
    expect(view.outcome).toEqual({ code: 'collision', message: 'already installed' })
    expect(view.result).toEqual({ httpStatus: 409, body: { error: 'exists' } })
    expect(view.stages.map((s) => s.status)).toEqual(['failed', 'pending'])
  })

  it('flags partially_applied outcomes on the summary', async () => {
    const { registry } = harness()
    const { operationId } = await registry.start(input({
      run: async () => ({ status: 'failed', code: 'partially_applied', httpStatus: 200, body: {} }),
    }))
    expect((await registry.await(operationId)).outcome).toEqual({ code: 'partially_applied', partiallyApplied: true })
  })
})

describe('operation registry — stages, items and progress', () => {
  it('advances stages in plan order, completing the previous stage and skipping unreached ones', async () => {
    const { registry } = harness({ now: () => Date.now() })
    const plan: OperationPlan = {
      stages: [
        { id: 'prep', kind: 'preparing', label: 'Prepare' },
        { id: 'download', kind: 'downloading', label: 'Download' },
        { id: 'verify', kind: 'verifying', label: 'Verify' },
        { id: 'commit', kind: 'committing', label: 'Commit' },
      ],
      pointOfNoReturn: 'commit',
    }
    const { operationId } = await registry.start(input({
      plan,
      run: async (op) => { op.stage('prep'); op.stage('verify'); op.skip('commit', 'nothing to commit'); return ok(null) },
    }))
    const view = await registry.await(operationId)
    expect(view.stages.map((s) => [s.id, s.status, s.skippedReason])).toEqual([
      ['prep', 'done', undefined],
      ['download', 'skipped', 'not needed'],
      ['verify', 'done', undefined],
      ['commit', 'skipped', 'nothing to commit'],
    ])
  })

  it('moves lastProgressAt on bytes and item completion but never on output', async () => {
    const h = harness()
    const gate = deferred()
    let ctx!: OperationContext
    const { operationId } = await h.registry.start(input({ run: async (op) => { ctx = op; op.stage('download'); await gate.promise; return ok(null) } }))
    await waitUntil(() => ctx !== undefined, { label: 'run started' })

    const startProgress = h.registry.get(operationId)!.lastProgressAt
    h.advance(5_000)
    ctx.output('downloading chunk 1')
    const afterOutput = h.registry.get(operationId)!
    expect(afterOutput.lastProgressAt).toBe(startProgress)
    expect(afterOutput.lastLivenessAt).toBe(new Date(T0 + 5_000).toISOString())
    expect(afterOutput.lastOutput).toBe('downloading chunk 1')

    h.advance(1_000)
    ctx.item('download', { id: 'a.tgz', label: 'a.tgz' })
    ctx.bytes('download', { received: 10, total: 100 }, 'a.tgz')
    expect(h.registry.get(operationId)!.lastProgressAt).toBe(new Date(T0 + 6_000).toISOString())

    h.advance(1_000)
    ctx.bytes('download', { received: 10, total: 100 }, 'a.tgz')
    expect(h.registry.get(operationId)!.lastProgressAt).toBe(new Date(T0 + 6_000).toISOString())

    h.advance(1_000)
    ctx.item('download', { id: 'a.tgz', label: 'a.tgz', status: 'done' })
    const view = h.registry.get(operationId)!
    expect(view.lastProgressAt).toBe(new Date(T0 + 8_000).toISOString())
    expect(view.stages[0].items).toEqual([{ id: 'a.tgz', label: 'a.tgz', status: 'done', bytes: { received: 10, total: 100 } }])
    gate.resolve()
    await h.registry.await(operationId)
  })

  it('records attempts as warnings without counting them as progress', async () => {
    const h = harness()
    const { operationId } = await h.registry.start(input({
      run: async (op) => {
        op.stage('download')
        h.advance(2_000)
        op.attempt('download', { n: 2, of: 2, reason: 'stalled', detail: 'no bytes for 30s' })
        return ok(null)
      },
    }))
    const view = await h.registry.await(operationId)
    expect(view.stages[0].attempt).toEqual({ n: 2, of: 2, reason: 'stalled', detail: 'no bytes for 30s' })
    expect(view.log.some((l) => l.level === 'warn' && l.text.includes('attempt 2 of 2') && l.stageId === 'download')).toBe(true)
  })

  it('keeps only the last 100 log lines', async () => {
    const { registry } = harness()
    const { operationId } = await registry.start(input({
      run: async (op) => { for (let i = 0; i < 150; i++) op.log(`line ${i}`); return ok(null) },
    }))
    const view = await registry.await(operationId)
    expect(view.log).toHaveLength(100)
    const texts = view.log.map((l) => l.text)
    expect(texts).toContain('line 149')
    expect(texts).not.toContain('line 50')
  })
})

describe('operation registry — cancel', () => {
  it('cancels before the point of no return, reporting cancelled only after run settles', async () => {
    const { registry } = harness()
    const settle = deferred()
    const entered = deferred()
    const { operationId } = await registry.start(input({
      run: async (op) => {
        op.stage('download')
        entered.resolve()
        await new Promise<void>((resolve) => op.signal.addEventListener('abort', () => resolve()))
        await settle.promise
        op.throwIfCancelled()
        return ok(null)
      },
    }))
    await entered.promise

    expect(registry.cancel(operationId)).toBe('cancelling')
    expect(registry.cancel(operationId)).toBe('cancelling')
    expect(registry.get(operationId)!.status).toBe('cancelling')
    await Promise.resolve()
    expect(registry.get(operationId)!.status).toBe('cancelling')

    settle.resolve()
    const view = await registry.await(operationId)
    expect(view.status).toBe('cancelled')
    expect(view.outcome).toEqual({ code: 'cancelled' })
    expect(view.result).toBeUndefined()
    expect(registry.cancel(operationId)).toBe('already_finished')
  })

  it('refuses to cross into the point of no return once cancel was requested', async () => {
    const { registry } = harness()
    const entered = deferred()
    const proceed = deferred()
    let committed = false
    const { operationId } = await registry.start(input({
      run: async (op) => {
        op.stage('download')
        entered.resolve()
        await proceed.promise
        op.stage('commit')
        committed = true
        return ok(null)
      },
    }))
    await entered.promise
    registry.cancel(operationId)
    proceed.resolve()
    expect((await registry.await(operationId)).status).toBe('cancelled')
    expect(committed).toBe(false)
  })

  it('refuses cancel after the point of no return and finishes normally', async () => {
    const { registry } = harness()
    const entered = deferred()
    const proceed = deferred()
    const { operationId } = await registry.start(input({
      run: async (op) => { op.stage('commit'); entered.resolve(); await proceed.promise; op.throwIfCancelled(); return ok(null) },
    }))
    await entered.promise
    expect(registry.get(operationId)!.cancellable).toBe(false)
    expect(registry.cancel(operationId)).toBe('not_cancellable')
    proceed.resolve()
    expect((await registry.await(operationId)).status).toBe('succeeded')
  })

  it("never allows cancel when the point of no return is 'start'", async () => {
    const { registry } = harness()
    const gate = deferred()
    const { operationId } = await registry.start(input({ plan: { ...PLAN, pointOfNoReturn: 'start' }, run: async () => { await gate.promise; return ok(null) } }))
    expect(registry.get(operationId)!.cancellable).toBe(false)
    expect(registry.cancel(operationId)).toBe('not_cancellable')
    gate.resolve()
    await registry.await(operationId)
  })

  it('stays cancellable throughout when the point of no return is null', async () => {
    const { registry } = harness()
    const entered = deferred()
    const { operationId } = await registry.start(input({
      plan: { ...PLAN, pointOfNoReturn: null },
      run: async (op) => {
        op.stage('commit')
        entered.resolve()
        await new Promise<void>((resolve) => op.signal.addEventListener('abort', () => resolve()))
        op.throwIfCancelled()
        return ok(null)
      },
    }))
    await entered.promise
    expect(registry.cancel(operationId)).toBe('cancelling')
    expect((await registry.await(operationId)).status).toBe('cancelled')
  })

  it('uses the run outcome when a cancelled run finishes anyway', async () => {
    const { registry } = harness()
    const entered = deferred()
    const proceed = deferred()
    const { operationId } = await registry.start(input({
      run: async (op) => { op.stage('download'); entered.resolve(); await proceed.promise; return ok('done') },
    }))
    await entered.promise
    registry.cancel(operationId)
    proceed.resolve()
    expect((await registry.await(operationId)).status).toBe('succeeded')
  })

  it('answers not_found for unknown ids', () => {
    expect(harness().registry.cancel('nope')).toBe('not_found')
  })

  it('treats an OperationCancelledError without a cancel request as unexpected', async () => {
    const { registry } = harness()
    const { operationId } = await registry.start(input({ run: async () => { throw new OperationCancelledError('x') } }))
    expect((await registry.await(operationId)).outcome?.code).toBe('unexpected')
  })
})

describe('operation registry — events', () => {
  it('publishes complete views with a strictly increasing rev', async () => {
    const h = harness()
    const { operationId } = await h.registry.start(input({
      run: async (op) => { op.stage('download'); op.item('download', { id: 'a', label: 'a', status: 'done' }); op.stage('commit'); return ok(null) },
    }))
    await h.registry.await(operationId)
    await waitUntil(() => h.published.at(-1)?.view.status === 'succeeded', { label: 'terminal published' })
    const revs = h.published.map((p) => p.view.rev)
    expect(revs).toEqual([...revs].sort((a, b) => a - b))
    expect(new Set(revs).size).toBe(revs.length)
    for (const { view } of h.published) {
      expect(view.id).toBe(operationId)
      expect(view.bootId).toBe('boot-a')
      expect(view.stages).toHaveLength(2)
    }
    expect(h.published.at(-1)!.kind).toBe('milestone')
  })

  it('throttles tick-only updates and always delivers the latest view', async () => {
    const h = harness({ tickIntervalMs: 60 })
    const gate = deferred()
    let ctx!: OperationContext
    const { operationId } = await h.registry.start(input({ run: async (op) => { ctx = op; op.stage('download'); await gate.promise; return ok(null) } }))
    await waitUntil(() => ctx !== undefined, { label: 'run started' })
    const before = h.published.length
    for (let i = 1; i <= 20; i++) ctx.bytes('download', { received: i, total: 20 })

    const ticks = () => h.published.slice(before).filter((p) => p.kind === 'tick')
    await waitUntil(() => ticks().at(-1)?.view.stages[0].bytes?.received === 20, { label: 'trailing tick' })
    expect(ticks().length).toBeLessThanOrEqual(2)
    gate.resolve()
    await h.registry.await(operationId)
  })

  it('trims the log in published views but keeps the full tail on reads', async () => {
    const h = harness()
    const { operationId } = await h.registry.start(input({ run: async (op) => { for (let i = 0; i < 60; i++) op.log(`l${i}`, 'warn'); return ok(null) } }))
    await h.registry.await(operationId)
    expect(h.published.at(-1)!.view.log.length).toBeLessThanOrEqual(20)
    expect(h.registry.get(operationId)!.log.length).toBeGreaterThan(20)
  })
})

describe('operation registry — audit, list and eviction', () => {
  it('writes exactly one audit record per finished operation', async () => {
    const h = harness()
    const { operationId } = await h.registry.start(input({ run: async (op) => { op.stage('download'); h.advance(1_500); return ok(null) } }))
    await h.registry.await(operationId)
    expect(h.audits).toEqual([{
      event: 'operation.succeeded',
      data: { operationId, kind: 'install', owner: 'core', origin: 'web', title: 'Install thing', durationMs: 1_500, code: 'ok' },
    }])
  })

  it('lists live and recently finished operations, newest first', async () => {
    const h = harness()
    const gate = deferred()
    const a = await h.registry.start(input({ fingerprint: 'a' }))
    await h.registry.await(a.operationId)
    h.advance(10)
    const b = await h.registry.start(input({ fingerprint: 'b', run: async () => { await gate.promise; return ok(null) } }))
    expect(h.registry.list().map((v) => v.id)).toEqual([b.operationId, a.operationId])
    gate.resolve()
    await h.registry.await(b.operationId)
  })

  it('evicts finished operations after the TTL and beyond the cap, never live ones', async () => {
    const h = harness({ finishedTtlMs: 1_000, maxFinished: 2 })
    const gate = deferred()
    const live = await h.registry.start(input({ fingerprint: 'live', run: async () => { await gate.promise; return ok(null) } }))
    const ids: string[] = []
    for (const fp of ['f1', 'f2', 'f3']) {
      const { operationId } = await h.registry.start(input({ fingerprint: fp }))
      await h.registry.await(operationId)
      ids.push(operationId)
      h.advance(10)
    }
    expect(h.registry.list().map((v) => v.id)).toEqual([ids[2], ids[1], live.operationId])
    expect(h.registry.get(ids[0])).toBeNull()

    h.advance(2_000)
    expect(h.registry.list().map((v) => v.id)).toEqual([live.operationId])
    gate.resolve()
    await h.registry.await(live.operationId)
  })

  it('resolves await for an already finished operation and rejects for unknown ids', async () => {
    const { registry } = harness()
    const { operationId } = await registry.start(input())
    await registry.await(operationId)
    expect((await registry.await(operationId)).status).toBe('succeeded')
    await expect(registry.await('missing')).rejects.toThrow('missing')
  })
})

describe('operation registry — quiet and stuck', () => {
  it('goes quiet then stuck on output without progress, logging stuck once per stage', async () => {
    const h = harness()
    const gate = deferred()
    let ctx!: OperationContext
    const { operationId } = await h.registry.start(input({ run: async (op) => { ctx = op; op.stage('download'); await gate.promise; return ok(null) } }))
    await waitUntil(() => ctx !== undefined, { label: 'run started' })

    const state = () => operationQuietState(h.registry.get(operationId)!, T0 + elapsed)
    let elapsed = 0
    const step = (ms: number) => { elapsed += ms; h.advance(ms); ctx.output(`still alive at ${elapsed}`) ; h.registry.checkQuiet() }

    step(9_000)
    expect(state().state).toBe('progressing')
    step(2_000)
    expect(state().state).toBe('quiet')
    step(20_000)
    expect(state()).toEqual({ state: 'stuck', stageId: 'download', sinceProgressMs: 31_000 })
    step(5_000)
    const stuckLines = h.registry.get(operationId)!.log.filter((l) => l.text.includes('looks stuck'))
    expect(stuckLines).toHaveLength(1)
    expect(stuckLines[0]).toMatchObject({ level: 'warn', stageId: 'download' })

    ctx.bytes('download', { received: 1, total: null })
    expect(state().state).toBe('progressing')
    gate.resolve()
    await h.registry.await(operationId)
  })
})

describe('operation registry — shutdown', () => {
  it('notes the shutdown in every live operation log without auditing', async () => {
    const h = harness()
    const gate = deferred()
    const { operationId } = await h.registry.start(input({ run: async () => { await gate.promise; return ok(null) } }))
    h.registry.shutdown()
    const view = h.registry.get(operationId)!
    expect(view.log.at(-1)).toMatchObject({ level: 'warn', text: 'Server stopping' })
    expect(h.audits).toEqual([])
    gate.resolve()
  })
})
