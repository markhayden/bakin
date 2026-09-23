// @vitest-environment jsdom
/**
 * useSelections — the Models page draft/save half of S10: staging makes
 * the page dirty, a save posts ONLY the draft under the loaded revision,
 * applied + pending refs leave the draft while failed ones stay for
 * Retry, a stale revision is re-fetched and re-posted once, and a refusal
 * lands as the bar's retryable error with the draft intact.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-use-selections-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('@makinbakin/sdk/navigation', () => ({
  useQueryState: (_key: string, defaultValue: string) => {
    const React = require('react') as typeof import('react')
    return React.useState(defaultValue)
  },
}))

import { act, renderHook, waitFor } from '@testing-library/react'
import { settleFor } from '../../helpers/wait'
import { actRender } from '../../rtl-settle'
import { useSelections } from '../../../plugins/models/components/use-selections'

const LUNA = 'openai-codex/gpt-5.6-luna'
const MINI = 'openai-codex/gpt-5.4-mini'
let revision = 'rev-1'
let posts: Array<{ revision: string; ops: Array<{ ref: string; set: Record<string, unknown> }> }> = []
let postResponses: Array<{ status: number; body: Record<string, unknown> }> = []
/** Extra states (fallbacks) and pending rows the GET serves; `gets` counts selections reads. */
let fallbacks: string[] = []
let pending: Array<{ refs: string[]; state: 'unsettled' | 'failed' | 'conflict'; detail?: string }> = []
let gets = 0
/** When set, the next POST waits on it — the in-flight window a test edits inside. */
let holdPost: Promise<void> | null = null
const originalFetch = globalThis.fetch

function selectionsBody() {
  gets += 1
  return {
    revision,
    support: { defaultModel: true, fallbackModels: true, defaultSubagentModel: false, aliases: false, perAgentSubagentModel: false, supportedThinkingLevels: ['off', 'low'], perTurnModel: true },
    states: [
      { ref: 'policy:defaultModel', model: LUNA, document: 'policy', label: 'Default model' },
      { ref: 'route:relay', model: null, document: 'routing', label: 'relay' },
      { ref: 'route:auto-title', model: null, document: 'routing', label: 'auto-title' },
      { ref: 'ui:mode', model: 'simple', document: 'routing', label: 'mode' },
      ...fallbacks.map((model, n) => ({ ref: `policy:fallback:${n}`, model, document: 'policy', label: `Fallback ${n + 1}` })),
    ],
    proposals: [],
    pending,
    evidence: { catalog: 'ok', runtimeAvailability: 'ok', credentials: 'ok', rejections: 'ok' },
  }
}
const planBody = {
  revision: 'rev-1',
  current: { agent: LUNA, chores: { model: LUNA, models: [LUNA], mixed: false }, enrichmentEnabled: true },
  recommended: { agent: { model: LUNA, why: '', suitability: 'known' }, chores: { model: MINI, why: '', suitability: 'known' }, routes: [], enrichment: 'chores', ops: [], notes: [] },
  routeProposals: { proposals: [], skipped: [] },
  candidates: 2,
}

beforeEach(() => {
  revision = 'rev-1'
  posts = []
  postResponses = []
  fallbacks = []
  pending = []
  gets = 0
  holdPost = null
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url.endsWith('/selections') && (init?.method ?? 'GET') === 'GET') return json(selectionsBody())
    if (url.endsWith('/plan')) return json(planBody)
    if (url.endsWith('/selections') && init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)) as (typeof posts)[number])
      if (holdPost) await holdPost
      const next = postResponses.shift() ?? { status: 200, body: { applied: posts.at(-1)!.ops.map((o) => o.ref), failed: [], pending: [], warnings: [], revision } }
      return json(next.body, next.status)
    }
    throw new Error(`unhandled ${init?.method ?? 'GET'} ${url}`)
  }) as unknown as typeof fetch
})
afterEach(() => { globalThis.fetch = originalFetch })

async function mount(options?: { pendingPollMs?: number }) {
  const rendered = await actRender(() => renderHook(() => useSelections(options)))
  await waitFor(() => expect(rendered.result.current.loading).toBe(false))
  return rendered
}

describe('useSelections draft + save', () => {
  it('staging makes the page dirty; staging the persisted value back cleans it', async () => {
    const { result } = await mount()
    expect(result.current.dirty).toBe(false)
    act(() => result.current.stage('route:relay', { model: MINI }))
    expect(result.current.dirty).toBe(true)
    expect(result.current.effective('route:relay')).toEqual({ model: MINI, thinking: null, staged: true })
    act(() => result.current.stage('route:relay', { model: null }))
    expect(result.current.dirty).toBe(false)
  })

  it('save posts ONLY the draft under the loaded revision; applied refs leave the draft', async () => {
    const { result } = await mount()
    act(() => result.current.stage('route:relay', { model: MINI }))
    act(() => result.current.stage('route:auto-title', { model: MINI }))
    let ok = false
    await act(async () => { ok = await result.current.save() })
    expect(ok).toBe(true)
    expect(posts).toEqual([{ revision: 'rev-1', ops: [{ ref: 'route:auto-title', set: { model: MINI } }, { ref: 'route:relay', set: { model: MINI } }] }])
    expect(result.current.dirty).toBe(false)
    expect(result.current.saveError).toBeNull()
  })

  it('failed refs stay staged with the error on the bar; pending refs leave the draft', async () => {
    const { result } = await mount()
    act(() => result.current.stage('route:relay', { model: MINI }))
    act(() => result.current.stage('route:auto-title', { model: MINI }))
    act(() => result.current.stage('policy:defaultModel', { model: MINI }))
    postResponses = [{ status: 200, body: { applied: ['route:auto-title'], failed: [{ ref: 'route:relay', error: { code: 'write_failed', message: 'adapter exploded' } }], pending: [{ ref: 'policy:defaultModel', intended: MINI }], warnings: [], revision } }]
    let ok = true
    await act(async () => { ok = await result.current.save() })
    expect(ok).toBe(false)
    expect([...result.current.draft.keys()]).toEqual(['route:relay'])
    expect(result.current.saveError).toContain('adapter exploded')
    expect(result.current.lastSave?.pending).toEqual(['policy:defaultModel'])
    // Retry carries only the failed ref.
    await act(async () => { await result.current.save() })
    expect(posts.at(-1)!.ops).toEqual([{ ref: 'route:relay', set: { model: MINI } }])
  })

  it('a stale revision is re-fetched and re-posted ONCE', async () => {
    const { result } = await mount()
    act(() => result.current.stage('route:relay', { model: MINI }))
    postResponses = [{ status: 409, body: { error: 'stale_revision', message: 'stale' } }]
    revision = 'rev-2'
    await act(async () => { await result.current.save() })
    expect(posts.map((p) => p.revision)).toEqual(['rev-1', 'rev-2'])
    expect(result.current.dirty).toBe(false)
  })

  it('an edit made WHILE a save is in flight survives the settle — the newer value was never sent (review P2)', async () => {
    const { result } = await mount()
    act(() => result.current.stage('route:relay', { model: MINI }))
    let release!: () => void
    holdPost = new Promise<void>((resolve) => { release = resolve })
    let saved: Promise<boolean>
    act(() => { saved = result.current.save() })
    await waitFor(() => expect(posts).toHaveLength(1))
    // The user moves on to another model, and reverts a second field to its pre-save value.
    act(() => result.current.stage('route:relay', { model: LUNA }))
    release()
    await act(async () => { await saved })
    expect(posts[0]!.ops).toEqual([{ ref: 'route:relay', set: { model: MINI } }])
    // MINI was applied; LUNA is still staged and rides the next save.
    expect(result.current.dirty).toBe(true)
    expect(result.current.effective('route:relay').model).toBe(LUNA)
    await act(async () => { await result.current.save() })
    expect(posts.at(-1)!.ops).toEqual([{ ref: 'route:relay', set: { model: LUNA } }])
  })

  it('reverting to the pre-save value during the save stays staged: the save is persisting the other value', async () => {
    const { result } = await mount()
    act(() => result.current.stage('route:auto-title', { model: MINI }))
    let release!: () => void
    holdPost = new Promise<void>((resolve) => { release = resolve })
    let saved: Promise<boolean>
    act(() => { saved = result.current.save() })
    await waitFor(() => expect(posts).toHaveLength(1))
    act(() => result.current.stage('route:auto-title', { model: null }))
    expect(result.current.dirty).toBe(true)
    release()
    await act(async () => { await saved })
    expect(result.current.draft.get('route:auto-title')).toEqual({ model: null })
  })

  it('a stale save carrying positional fallback ops is re-posted only when the fallback list is unchanged', async () => {
    fallbacks = [MINI, LUNA]
    const { result } = await mount()
    act(() => result.current.stage('policy:fallback:1', { model: null }))
    postResponses = [{ status: 409, body: { error: 'stale_revision', message: 'stale' } }]
    revision = 'rev-2'
    await act(async () => { await result.current.save() })
    expect(posts.map((p) => p.revision)).toEqual(['rev-1', 'rev-2'])
    expect(result.current.dirty).toBe(false)
    expect(result.current.saveError).toBeNull()
  })

  it('a stale save whose fallback list MOVED drops the positional ops instead of leaving them staged for Retry (review P2)', async () => {
    fallbacks = [MINI, LUNA]
    const { result } = await mount()
    act(() => result.current.stage('policy:fallback:1', { model: null }))
    act(() => result.current.stage('route:relay', { model: MINI }))
    postResponses = [{ status: 409, body: { error: 'stale_revision', message: 'stale' } }]
    // Another editor reordered the list: position 1 is now MINI, not LUNA.
    revision = 'rev-2'
    fallbacks = [LUNA, MINI]
    let ok = true
    await act(async () => { ok = await result.current.save() })
    expect(ok).toBe(false)
    // One attempt only; the positional op is gone, the named one is kept for Retry.
    expect(posts).toHaveLength(1)
    expect([...result.current.draft.keys()]).toEqual(['route:relay'])
    expect(result.current.saveError).toContain('fallback')
    await waitFor(() => expect(result.current.selections?.states.find((s) => s.ref === 'policy:fallback:1')?.model).toBe(MINI))
    await act(async () => { await result.current.save() })
    expect(posts.at(-1)!.ops).toEqual([{ ref: 'route:relay', set: { model: MINI } }])
  })

  it('a write awaiting runtime confirmation is re-read on a cadence until it settles — no manual reload (review P2)', async () => {
    pending = [{ refs: ['policy:defaultModel'], state: 'unsettled' }]
    const { result } = await mount({ pendingPollMs: 20 })
    expect(result.current.pendingRefs.get('policy:defaultModel')?.state).toBe('unsettled')
    const before = gets
    await waitFor(() => expect(gets).toBeGreaterThan(before + 1))
    // The runtime confirmed: the next read carries no pending row and the page drops the chip on its own.
    pending = []
    await waitFor(() => expect(result.current.pendingRefs.size).toBe(0))
    const settledAt = gets
    await settleFor(80, 'polling must stop once nothing is pending — four poll intervals with no further read')
    expect(gets).toBe(settledAt)
  })

  it('a refusal (ineligible model) keeps the draft and surfaces the reason + proposal', async () => {
    const { result } = await mount()
    act(() => result.current.stage('policy:defaultModel', { model: 'openai/gpt-6-astra' }))
    postResponses = [{ status: 400, body: { error: 'model_not_eligible', message: 'openai/gpt-6-astra has no credentials', proposal: { to: LUNA } } }]
    let ok = true
    await act(async () => { ok = await result.current.save() })
    expect(ok).toBe(false)
    expect(result.current.dirty).toBe(true)
    expect(result.current.saveError).toContain('no credentials')
    expect(result.current.saveError).toContain(`Try ${LUNA} instead`)
  })
})
