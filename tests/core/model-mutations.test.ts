/**
 * The ONE write path for model selections (#907, D25/D29): serialized,
 * revision-checked, capability-checked, eligibility-checked, with TRI-STATE
 * write outcomes. An adapter write that does not settle within the deadline
 * is recorded pending and its DOCUMENT stays reserved until the promise
 * settles — a read never releases it, so a retry can never overlap it.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-mutations-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db'), audit: join(testDir, 'audit.jsonl') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { createMockRuntimeAdapter, mockCredentials } from '../../packages/core/src/adapters/runtime/testing'
import type { RoutingConfig } from '../../src/core/model-routing'
import { computeRevision, enumerateSelections, evaluateSelections, type SelectionState } from '../../src/core/model-selections'
import {
  buildRestoreOps,
  MutationRefused,
  createSelectionMutator,
  type MutationDeps,
} from '../../src/core/model-mutations'
import { waitUntil } from '../helpers/wait'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

const LIVE = 'openai-codex/gpt-5.5'
const ASTRA = 'openai-codex/gpt-6-astra'
const DEAD = 'openai/gpt-5.6-luna'

interface Fixture {
  deps: MutationDeps
  agents: Map<string, { model?: string; subagentModel?: string }>
  updateCalls: string[]
  routing: { config: RoutingConfig; uiMode: 'simple' | 'advanced' | null }
  /** Make the next agents.update hang until `release()` is called. */
  hangNextUpdate(): { release(): void; fail(err: Error): void }
  /** Make the next agents.update for ONE agent hang (several can be armed at once). */
  hangUpdate(agentId: string): { release(): void; fail(err: Error): void }
}

function fixture(opts: { pi?: boolean; deadlineMs?: number; bootId?: string } = {}): Fixture {
  const agents = new Map<string, { model?: string; subagentModel?: string }>([['main', {}], ['enrich', { model: DEAD }]])
  const updateCalls: string[] = []
  let hang: { promise: Promise<void>; release(): void; fail(err: Error): void } | null = null
  /** Per-agent hangs for overlapping-write scenarios (`hangUpdate(agentId)`). */
  const hangs = new Map<string, { promise: Promise<void>; release(): void; fail(err: Error): void }>()
  const routing = { config: { routes: [], tagOverrides: [] } as RoutingConfig, uiMode: null as 'simple' | 'advanced' | null }
  const policy = { defaultModel: LIVE, fallbackModels: [] as string[], defaultSubagentModel: null as string | null, aliases: {} as Record<string, string> }
  const base = createMockRuntimeAdapter({
    credentials: mockCredentials([{ providerId: 'openai-codex', configured: true }, { providerId: 'openai', configured: false }]),
  })
  const runtime = {
    ...base,
    agents: {
      ...base.agents,
      list: async () => [...agents.entries()].map(([id, a]) => ({ id, name: id, ...a })),
      update: async (id: string, patch: { model?: string | null; subagentModel?: string | null }) => {
        updateCalls.push(id)
        const pending = hang ?? hangs.get(id) ?? null
        hang = null
        hangs.delete(id)
        if (pending) await pending.promise
        const a = agents.get(id)!
        if (patch.model !== undefined) { if (patch.model === null) delete a.model; else a.model = patch.model }
        if (patch.subagentModel !== undefined) { if (patch.subagentModel === null) delete a.subagentModel; else a.subagentModel = patch.subagentModel }
        return { id, name: id, ...a }
      },
    },
    models: {
      ...base.models,
      listAvailable: async () => [
        { id: LIVE, available: true },
        { id: ASTRA, available: true },
        { id: DEAD, available: false, unavailableReason: 'no_credentials' as const },
        { id: 'openai-codex/gpt-5.6-luna', available: true },
      ],
      routingSupport: () => ({
        defaultModel: true,
        fallbackModels: !opts.pi,
        defaultSubagentModel: !opts.pi,
        aliases: !opts.pi,
        perAgentSubagentModel: !opts.pi,
        supportedThinkingLevels: ['off', 'low', 'medium', 'high'],
        perTurnModel: true,
      }),
      routingPolicy: async () => ({ ...policy }),
      setRoutingPolicy: async (patch: Partial<typeof policy>) => { Object.assign(policy, patch) },
    },
  }
  const stateDir = join(testDir, `state-${randomUUID()}`)
  mkdirSync(stateDir, { recursive: true })
  const deps: MutationDeps = {
    runtime,
    loadRouting: () => ({ routing: routing.config, uiMode: routing.uiMode }),
    saveRouting: (config, uiMode) => { routing.config = config; routing.uiMode = uiMode },
    stateDir,
    bootId: opts.bootId ?? 'boot-A',
    deadlineMs: opts.deadlineMs ?? 50,
    listOpenRejections: () => [],
    audit: () => {},
  }
  return {
    deps,
    agents,
    updateCalls,
    routing,
    hangNextUpdate() {
      let release!: () => void
      let fail!: (err: Error) => void
      const promise = new Promise<void>((res, rej) => { release = res; fail = rej })
      hang = { promise, release, fail }
      return { release, fail }
    },
    hangUpdate(agentId: string) {
      let release!: () => void
      let fail!: (err: Error) => void
      const promise = new Promise<void>((res, rej) => { release = res; fail = rej })
      hangs.set(agentId, { promise, release, fail })
      return { release, fail }
    },
  }
}

async function currentRevision(deps: MutationDeps): Promise<string> {
  const { routing, uiMode } = deps.loadRouting()
  return computeRevision(await enumerateSelections(deps.runtime, { routing, uiMode }))
}

describe('mutateSelections — validation', () => {
  it('refuses a stale revision with 409 and the current revision', async () => {
    const f = fixture()
    const m = createSelectionMutator(f.deps)
    await expect(m.mutate({ revision: 'stale', ops: [{ ref: 'policy:defaultModel', set: { model: ASTRA } }] }))
      .rejects.toMatchObject({ status: 409, code: 'stale_revision', current: await currentRevision(f.deps) })
  })

  it('refuses an ineligible model with 400 and carries the proposal; unknown passes with a warning', async () => {
    const f = fixture()
    const m = createSelectionMutator(f.deps)
    const rev = await currentRevision(f.deps)
    const err = await m.mutate({ revision: rev, ops: [{ ref: 'agent:main:model', set: { model: DEAD } }] }).catch((e) => e)
    expect(err).toBeInstanceOf(MutationRefused)
    expect(err).toMatchObject({ status: 400, code: 'model_not_eligible', ref: 'agent:main:model' })
    expect(err.proposal).toMatchObject({ to: 'openai-codex/gpt-5.6-luna', source: 'same-id-credentialed-provider' })
    expect(f.agents.get('main')!.model).toBeUndefined()
  })

  it('refuses ops the runtime cannot persist (Pi: subagent pins even to clear; non-empty fallbacks/aliases)', async () => {
    const f = fixture({ pi: true })
    const m = createSelectionMutator(f.deps)
    const rev = await currentRevision(f.deps)
    await expect(m.mutate({ revision: rev, ops: [{ ref: 'agent:main:subagentModel', set: { model: null } }] }))
      .rejects.toMatchObject({ status: 400, code: 'unsupported_by_runtime' })
    await expect(m.mutate({ revision: rev, ops: [{ ref: 'policy:fallback:0', set: { model: ASTRA } }] }))
      .rejects.toMatchObject({ status: 400, code: 'unsupported_by_runtime' })
    // Clearing a policy field Pi accepts as empty is fine.
    const res = await m.mutate({ revision: rev, ops: [{ ref: 'policy:defaultSubagentModel', set: { model: null } }] })
    expect(res.applied).toEqual(['policy:defaultSubagentModel'])
  })

  it('two concurrent mutations against one revision: one applies, the other is 409', async () => {
    const f = fixture()
    const m = createSelectionMutator(f.deps)
    const rev = await currentRevision(f.deps)
    const results = await Promise.allSettled([
      m.mutate({ revision: rev, ops: [{ ref: 'route:relay', set: { model: ASTRA } }] }),
      m.mutate({ revision: rev, ops: [{ ref: 'route:auto-title', set: { model: ASTRA } }] }),
    ])
    const statuses = results.map((r) => r.status)
    expect(statuses.sort()).toEqual(['fulfilled', 'rejected'])
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ code: 'stale_revision' })
  })
})

describe('mutateSelections — agent-scoped eligibility', () => {
  /** Credentials keyed per agent (OpenClaw): only `enrich` holds an openai-codex key. */
  function scoped(f: Fixture) {
    f.deps.runtime.credentials = {
      providers: async (opts?: { agentId?: string }) => ({
        evidence: 'complete' as const,
        providers: [{ providerId: 'openai-codex', configured: opts?.agentId === 'enrich' }, { providerId: 'openai', configured: false }],
      }),
    }
  }

  it('an agent pin is validated with THAT agent\'s credentials: accepted for the agent that holds the key, refused for one that does not', async () => {
    const f = fixture()
    scoped(f)
    const m = createSelectionMutator(f.deps)
    const codex = 'openai-codex/gpt-5.6-luna'
    const ok = await m.mutate({ revision: await currentRevision(f.deps), ops: [{ ref: 'agent:enrich:model', set: { model: codex } }] })
    expect(ok.applied).toEqual(['agent:enrich:model'])
    await expect(m.mutate({ revision: await currentRevision(f.deps), ops: [{ ref: 'agent:main:model', set: { model: codex } }] }))
      .rejects.toMatchObject({ code: 'model_not_eligible', status: 400 })
  })

  it('the inventory evaluates each agent pin under its own credentials (an unscoped read would condemn a working pin)', async () => {
    const f = fixture()
    scoped(f)
    f.agents.get('enrich')!.model = 'openai-codex/gpt-5.6-luna'
    const m = createSelectionMutator(f.deps)
    const { states } = await m.reconcile()
    const evaluated = await evaluateSelections(f.deps.runtime, states, { listOpenRejections: () => [] })
    expect(evaluated.eligibilityOf(states.find((s) => s.ref === 'agent:enrich:model')!)?.status).toBe('eligible')
    // The runtime default is judged unscoped — the key only `enrich` holds does not vouch for everyone.
    expect(evaluated.eligibilityOf(states.find((s) => s.ref === 'policy:defaultModel')!)).toMatchObject({ status: 'ineligible', reason: 'no_credentials' })
    expect(evaluated.eligibilityOf(states.find((s) => s.ref === 'agent:main:model')!)).toBeUndefined()
  })
})

describe('mutateSelections — writes per document', () => {
  it('applies ops across all three documents in one call and returns the post-write revision', async () => {
    const f = fixture()
    const m = createSelectionMutator(f.deps)
    const rev = await currentRevision(f.deps)
    const res = await m.mutate({
      revision: rev,
      ops: [
        { ref: 'policy:defaultModel', set: { model: ASTRA } },
        { ref: 'agent:enrich:model', set: { model: 'openai-codex/gpt-5.6-luna' } },
        { ref: 'route:enrichment', set: { model: ASTRA, thinking: 'low' } },
        { ref: 'tag:legal', set: { model: LIVE } },
        { ref: 'ui:mode', set: { model: 'simple' } },
      ],
    })
    expect(res.failed).toEqual([])
    expect(res.pending).toEqual([])
    expect(res.applied.sort()).toEqual(['agent:enrich:model', 'policy:defaultModel', 'route:enrichment', 'tag:legal', 'ui:mode'])
    expect(f.agents.get('enrich')!.model).toBe('openai-codex/gpt-5.6-luna')
    expect(f.routing.config.routes).toEqual([{ workClass: 'enrichment', model: ASTRA, thinking: 'low' }])
    expect(f.routing.config.tagOverrides).toEqual([{ tag: 'legal', model: LIVE }])
    expect(f.routing.uiMode).toBe('simple')
    expect(res.revision).toBe(await currentRevision(f.deps))
    expect(res.revision).not.toBe(rev)
  })

  it('folds two refs on one agent document into ONE adapter write', async () => {
    const f = fixture()
    const m = createSelectionMutator(f.deps)
    const rev = await currentRevision(f.deps)
    await m.mutate({ revision: rev, ops: [
      { ref: 'agent:main:model', set: { model: ASTRA } },
      { ref: 'agent:main:subagentModel', set: { model: LIVE } },
    ] })
    expect(f.updateCalls).toEqual(['main'])
    expect(f.agents.get('main')).toEqual({ model: ASTRA, subagentModel: LIVE })
  })

  it('a rejected adapter write is reported failed (not thrown) and the other documents still apply', async () => {
    const f = fixture()
    const m = createSelectionMutator(f.deps)
    const rev = await currentRevision(f.deps)
    const h = f.hangNextUpdate()
    setTimeout(() => h.fail(new Error('adapter exploded')), 5)
    const res = await m.mutate({ revision: rev, ops: [
      { ref: 'agent:main:model', set: { model: ASTRA } },
      { ref: 'route:relay', set: { model: ASTRA } },
    ] })
    expect(res.applied).toEqual(['route:relay'])
    expect(res.failed).toEqual([{ ref: 'agent:main:model', error: { code: 'write_failed', message: 'adapter exploded' } }])
  })

  it('writes a full-state snapshot BEFORE applying when asked, bounded to five', async () => {
    const f = fixture()
    const m = createSelectionMutator(f.deps)
    for (let i = 0; i < 6; i++) {
      const rev = await currentRevision(f.deps)
      await m.mutate({ revision: rev, ops: [{ ref: 'route:relay', set: { model: i % 2 ? ASTRA : LIVE } }], snapshot: 'reset' })
    }
    const files = readdirSync(join(f.deps.stateDir, 'snapshots')).sort()
    expect(files).toHaveLength(5)
    const snap = JSON.parse(readFileSync(join(f.deps.stateDir, 'snapshots', files.at(-1)!), 'utf8')) as { revision: string; states: SelectionState[] }
    // (Read the fields BEFORE any toMatchObject: bun 1.3.13's asymmetric
    // matchers mutate the received object — seen here as states → {}.)
    const states = snap.states
    expect(typeof snap.revision).toBe('string')
    expect(Array.isArray(states)).toBe(true)
    // The last snapshot holds the state BEFORE the sixth write: write #5 (i=4) set relay = LIVE.
    expect(states.filter((s) => s.ref === 'route:relay').map((s) => s.model)).toEqual([LIVE])
  })
})

describe('mutateSelections — late-settling writes (S10)', () => {
  it('timeout → pending; an intervening read does NOT release; retry ⇒ 409 write_pending; settle ⇒ intended, ONE write', async () => {
    const f = fixture({ deadlineMs: 30 })
    const m = createSelectionMutator(f.deps)
    const rev = await currentRevision(f.deps)
    const h = f.hangNextUpdate()

    const res = await m.mutate({ revision: rev, ops: [{ ref: 'agent:main:model', set: { model: ASTRA } }] })
    expect(res.applied).toEqual([])
    expect(res.pending).toEqual([{ ref: 'agent:main:model', intended: ASTRA }])
    const file = JSON.parse(readFileSync(join(f.deps.stateDir, 'pending-writes.json'), 'utf8'))
    expect(file.writes).toHaveLength(1)
    expect(file.writes[0]).toMatchObject({ document: 'agent:main', bootId: 'boot-A', intended: { 'agent:main:model': ASTRA } })

    // Intervening read: value still equals previous — reservation MUST hold.
    const status = await m.reconcile()
    expect(status.pending).toEqual([expect.objectContaining({ document: 'agent:main', state: 'unsettled' })])

    // Retry on the same document is refused while the original is unsettled.
    await expect(m.mutate({ revision: res.revision, ops: [{ ref: 'agent:main:model', set: { model: LIVE } }] }))
      .rejects.toMatchObject({ status: 409, code: 'write_pending', document: 'agent:main' })
    // Another document is not blocked.
    const other = await m.mutate({ revision: res.revision, ops: [{ ref: 'route:relay', set: { model: ASTRA } }] })
    expect(other.applied).toEqual(['route:relay'])

    // The original settles: the record clears, the value is the intended one, exactly one write happened.
    h.release()
    await waitUntil(async () => (await m.reconcile()).pending.length === 0, { label: 'pending write settles' })
    expect(f.agents.get('main')!.model).toBe(ASTRA)
    expect(f.updateCalls).toEqual(['main'])
    expect(existsSync(join(f.deps.stateDir, 'pending-writes.json')) ? JSON.parse(readFileSync(join(f.deps.stateDir, 'pending-writes.json'), 'utf8')).writes : []).toEqual([])
  })

  it('a write that settles while a LATER write is still awaiting its deadline is released — the later timeout never resurrects it', async () => {
    const f = fixture({ deadlineMs: 100 })
    const a = f.hangUpdate('main')
    f.hangUpdate('enrich') // stays hung: B ends the call as pending
    const m = createSelectionMutator(f.deps)
    const run = m.mutate({ revision: await currentRevision(f.deps), ops: [
      { ref: 'agent:main:model', set: { model: ASTRA } },
      { ref: 'agent:enrich:model', set: { model: ASTRA } },
    ] })
    // A times out at ~100 ms; B's write starts then. Settle A while B waits.
    await new Promise((r) => setTimeout(r, 150))
    a.release()
    const result = await run
    expect(result.pending.map((p) => p.ref).sort()).toEqual(['agent:enrich:model', 'agent:main:model'])
    await new Promise((r) => setTimeout(r, 20))
    const { pending } = await m.reconcile()
    expect(pending.map((p) => p.document)).toEqual(['agent:enrich'])
    // …so the settled document is writable again, not 409 write_pending forever.
    const again = await m.mutate({ revision: (await m.reconcile()).revision, ops: [{ ref: 'agent:main:model', set: { model: null } }] })
    expect(again.applied).toEqual(['agent:main:model'])
  })

  it('a late FAILURE converts the record to failed and frees the document for Retry', async () => {
    const f = fixture({ deadlineMs: 30 })
    const m = createSelectionMutator(f.deps)
    const rev = await currentRevision(f.deps)
    const h = f.hangNextUpdate()
    const res = await m.mutate({ revision: rev, ops: [{ ref: 'agent:main:model', set: { model: ASTRA } }] })
    expect(res.pending).toHaveLength(1)
    h.fail(new Error('gateway timeout'))
    await waitUntil(async () => (await m.reconcile()).pending.some((p) => p.state === 'failed'), { label: 'late failure recorded' })
    const retry = await m.mutate({ revision: res.revision, ops: [{ ref: 'agent:main:model', set: { model: ASTRA } }] })
    expect(retry.applied).toEqual(['agent:main:model'])
    expect((await m.reconcile()).pending).toEqual([])
  })

  it('a record from a PRIOR boot is classified by re-read: intended ⇒ resolved, previous ⇒ failed, else conflict', async () => {
    const f = fixture({ bootId: 'boot-B' })
    // Simulate three records left by boot-A.
    f.agents.set('a1', { model: ASTRA })
    f.agents.set('a2', {})
    f.agents.set('a3', { model: LIVE })
    writeFileSync(join(f.deps.stateDir, 'pending-writes.json'), JSON.stringify({ writes: [
      { document: 'agent:a1', refs: ['agent:a1:model'], previous: { 'agent:a1:model': null }, intended: { 'agent:a1:model': ASTRA }, startedAt: 1, revision: 'x', bootId: 'boot-A' },
      { document: 'agent:a2', refs: ['agent:a2:model'], previous: { 'agent:a2:model': null }, intended: { 'agent:a2:model': ASTRA }, startedAt: 1, revision: 'x', bootId: 'boot-A' },
      { document: 'agent:a3', refs: ['agent:a3:model'], previous: { 'agent:a3:model': null }, intended: { 'agent:a3:model': ASTRA }, startedAt: 1, revision: 'x', bootId: 'boot-A' },
    ] }))
    const m = createSelectionMutator(f.deps)
    const status = await m.reconcile()
    expect(status.pending.find((p) => p.document === 'agent:a1')).toBeUndefined() // resolved ⇒ removed
    expect(status.pending.find((p) => p.document === 'agent:a2')).toMatchObject({ state: 'failed', detail: expect.stringMatching(/restart/) })
    expect(status.pending.find((p) => p.document === 'agent:a3')).toMatchObject({ state: 'conflict' })
    // A failed prior-boot record does not block a retry; a conflict does until acknowledged.
    const rev = await currentRevision(f.deps)
    await expect(m.mutate({ revision: rev, ops: [{ ref: 'agent:a2:model', set: { model: ASTRA } }] })).resolves.toMatchObject({ applied: ['agent:a2:model'] })
    await expect(m.mutate({ revision: (await m.reconcile()).revision, ops: [{ ref: 'agent:a3:model', set: { model: ASTRA } }] }))
      .rejects.toMatchObject({ code: 'write_pending' })
  })
})

describe('buildRestoreOps — snapshot vs current → ops', () => {
  it('restores changed refs, re-adds removed ones, clears refs that did not exist at snapshot time', () => {
    const snapshot: SelectionState[] = [
      { ref: 'policy:defaultModel', model: LIVE, document: 'policy', label: '' },
      { ref: 'agent:enrich:model', model: DEAD, document: 'agent:enrich', label: '' },
      { ref: 'route:enrichment', model: ASTRA, thinking: 'low', document: 'routing', label: '' },
      { ref: 'tag:legal', model: LIVE, document: 'routing', label: '' },
    ]
    const current: SelectionState[] = [
      { ref: 'policy:defaultModel', model: ASTRA, document: 'policy', label: '' },
      { ref: 'agent:enrich:model', model: null, document: 'agent:enrich', label: '' },
      { ref: 'route:enrichment', model: ASTRA, document: 'routing', label: '' },
      { ref: 'tag:urgent', model: ASTRA, document: 'routing', label: '' },
    ]
    const ops = buildRestoreOps(snapshot, current)
    expect(ops).toEqual(expect.arrayContaining([
      { ref: 'policy:defaultModel', set: { model: LIVE } },
      { ref: 'agent:enrich:model', set: { model: DEAD } },
      { ref: 'route:enrichment', set: { model: ASTRA, thinking: 'low' } },
      { ref: 'tag:legal', set: { model: LIVE } },
      { ref: 'tag:urgent', set: { model: null, thinking: null } },
    ]))
    expect(ops).toHaveLength(5)
  })

  it('is FULL state: the page mode restores, and a thinking-only tag added since the snapshot is cleared', () => {
    const snapshot: SelectionState[] = [
      { ref: 'policy:defaultModel', model: LIVE, document: 'policy', label: '' },
      { ref: 'ui:mode', model: 'advanced', document: 'routing', label: '' },
    ]
    const current: SelectionState[] = [
      { ref: 'policy:defaultModel', model: LIVE, document: 'policy', label: '' },
      { ref: 'ui:mode', model: 'simple', document: 'routing', label: '' },
      { ref: 'tag:heavy', model: null, thinking: 'high', document: 'routing', label: '' },
      { ref: 'tag:inert', model: null, thinking: 'inherit', document: 'routing', label: '' },
    ]
    expect(buildRestoreOps(snapshot, current)).toEqual(expect.arrayContaining([
      { ref: 'ui:mode', set: { model: 'advanced' } },
      { ref: 'tag:heavy', set: { model: null, thinking: null } },
    ]))
    expect(buildRestoreOps(snapshot, current)).toHaveLength(2)
  })
})
