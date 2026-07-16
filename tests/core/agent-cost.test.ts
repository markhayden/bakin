/**
 * meterAgentTurn — shared per-turn cost attribution used by every Bakin-side
 * send (dispatch + watchdog/doctor/orchestrator). Verifies it prices via the
 * hook, records a ledger row (synthetic id + null task for non-dispatch), and
 * prefers the model the runtime actually ran over the requested override.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const dir = join(tmpdir(), 'bakin-test-agent-cost')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => dir, getBakinPaths: () => ({ root: dir, db: join(dir, 'bakin.db') }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => dir, getBakinPaths: () => ({ root: dir, db: join(dir, 'bakin.db') }) }))
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))

const costRows: Array<Record<string, unknown>> = []
mock.module('../../src/core/execution-ledger', () => ({ recordRunCost: (r: Record<string, unknown>) => costRows.push(r) }))

const usageRows: Array<Record<string, unknown>> = []
mock.module('../../src/core/usage', () => ({ recordUsage: (e: Record<string, unknown>) => usageRows.push(e) }))

let priceTurnImpl: (data: Record<string, unknown>) => unknown = () => ({ model: null, costUsdMicros: null })
let priceImageImpl: (data: Record<string, unknown>) => unknown = () => ({ model: null, costUsdMicros: null })
const hookRegistryMock = () => ({
  getHookRegistry: () => ({ invoke: async (name: string, data: Record<string, unknown>) => {
    if (name === 'models.priceTurn') return priceTurnImpl(data)
    if (name === 'models.priceImage') return priceImageImpl(data)
    return undefined
  } }),
})
// getHookRegistry now lives in the leaf module (WS2 K1); mock the leaf (the
// real import site post-K1) plus the legacy facade for belt-and-suspenders.
mock.module('@bakin/core/hooks/hook-registry-singleton', hookRegistryMock)
mock.module('../../src/core/plugin-registry', hookRegistryMock)

import { meterAgentTurn, meterImageTurn } from '../../src/core/agent-cost'

beforeEach(() => {
  costRows.length = 0
  usageRows.length = 0
  priceTurnImpl = () => ({ model: null, costUsdMicros: null })
  priceImageImpl = () => ({ model: null, costUsdMicros: null })
})

describe('meterAgentTurn', () => {
  it('records a non-dispatch row with a synthetic runId and null taskId', async () => {
    priceTurnImpl = () => ({ model: 'anthropic/claude-sonnet-4-6', costUsdMicros: 4200 })
    await meterAgentTurn({
      agent: 'main',
      activityClass: 'system',
      result: { id: 'm', usage: { input: 100, output: 50, total: 150 }, metadata: { adapterTurnId: 'turn-m' } },
      name: 'watchdog-alert',
    })
    expect(costRows).toHaveLength(1)
    expect(costRows[0].taskId).toBeNull()
    expect(String(costRows[0].runId)).toStartWith('turn:')
    expect(costRows[0].costUsdMicros).toBe(4200)
    expect(usageRows[0]).toMatchObject({
      kind: 'agent',
      activityClass: 'system',
      name: 'watchdog-alert',
      tokensIn: 100,
      tokensOut: 50,
      costUsdMicros: 4200,
      meta: { resultId: 'm', turnId: 'turn-m' },
    })
  })

  it('uses the dispatch runId + taskId when provided', async () => {
    await meterAgentTurn({ runId: 'task:t1:d1', taskId: 't1', agent: 'pixel', activityClass: 'user', result: { id: 'm', usage: { input: 1, output: 1 } } })
    expect(costRows[0].runId).toBe('task:t1:d1')
    expect(costRows[0].taskId).toBe('t1')
    expect(costRows[0].usageKind).toBe('tokens')
    expect(costRows[0].totalTokens).toBe(2)
  })

  it('threads cache read/write tokens into the cost row and the usage entry', async () => {
    await meterAgentTurn({
      runId: 'task:t-cache:d1', taskId: 't-cache', agent: 'pixel',
      activityClass: 'user',
      result: { id: 'm', usage: { input: 1000, output: 50, total: 1050, cacheRead: 900, cacheWrite: 40 } },
    })
    expect(costRows[0]).toMatchObject({ cacheReadTokens: 900, cacheWriteTokens: 40 })
    expect(usageRows[0]).toMatchObject({ tokensCacheRead: 900, tokensCacheWrite: 40 })
  })

  it('preserves an explicit total even when separately reported cache tokens are larger', async () => {
    await meterAgentTurn({
      agent: 'pixel',
      activityClass: 'user',
      result: { id: 'm', usage: { input: 537, output: 73, total: 610, cacheRead: 34_200 } },
    })

    expect(costRows[0]).toMatchObject({
      inputTokens: 537,
      outputTokens: 73,
      cacheReadTokens: 34_200,
      totalTokens: 610,
    })
  })

  it('includes cache components when it must derive a missing total', async () => {
    await meterAgentTurn({
      agent: 'pixel',
      activityClass: 'user',
      result: { id: 'm', usage: { input: 537, output: 73, cacheRead: 34_200 } },
    })

    expect(costRows[0].totalTokens).toBe(34_810)
  })

  it('withholds a derived total when either base token counter is missing', async () => {
    await meterAgentTurn({
      agent: 'pixel',
      activityClass: 'user',
      result: { id: 'm', usage: { input: 537, cacheRead: 34_200 } },
    })

    expect(costRows[0]).toMatchObject({
      inputTokens: 537,
      outputTokens: null,
      cacheReadTokens: 34_200,
      totalTokens: null,
    })
  })

  it('omits cache fields entirely when the runtime reports no cache usage', async () => {
    await meterAgentTurn({ agent: 'pixel', activityClass: 'user', result: { id: 'm', usage: { input: 10, output: 5 } } })
    expect(costRows[0].cacheReadTokens ?? null).toBeNull()
    expect('tokensCacheRead' in usageRows[0]).toBe(false)
    expect('tokensCacheWrite' in usageRows[0]).toBe(false)
  })

  it('prices the model the runtime actually ran, not the requested override', async () => {
    // Runtime reports it ran modelY; routing had requested modelX.
    const seen: Record<string, unknown>[] = []
    priceTurnImpl = (d) => { seen.push(d); return { model: d.model as string, costUsdMicros: 999 } }
    await meterAgentTurn({ agent: 'pixel', activityClass: 'user', resolvedModel: 'modelX', result: { id: 'm', usage: { input: 1, output: 1, model: 'modelY' } } })
    expect(seen[0].model).toBe('modelY') // priced against what ran
    expect(costRows[0].model).toBe('modelY')
  })

  it('persists the billing attribution (provider + lane) from the pricing hook', async () => {
    priceTurnImpl = () => ({ model: 'openai-codex/gpt-5.5-codex', provider: 'openai-codex', lane: 'subscription', costUsdMicros: null })
    await meterAgentTurn({ agent: 'main', activityClass: 'user', result: { id: 'm', usage: { input: 10, output: 5 } } })
    expect(costRows[0]).toMatchObject({ provider: 'openai-codex', lane: 'subscription' })
  })

  it('records null provider/lane when the hook does not attribute billing', async () => {
    priceTurnImpl = () => ({ model: 'm', costUsdMicros: 10 })
    await meterAgentTurn({ agent: 'main', activityClass: 'user', result: { id: 'm', usage: { input: 1, output: 1 } } })
    expect(costRows[0].provider ?? null).toBeNull()
    expect(costRows[0].lane ?? null).toBeNull()
  })

  it('records null cost (unmetered) when pricing is unavailable, never throws', async () => {
    priceTurnImpl = () => { throw new Error('boom') }
    await meterAgentTurn({ agent: 'pixel', activityClass: 'user', resolvedModel: 'fallback/model', result: { id: 'm', usage: { input: 1, output: 1 } } })
    expect(costRows).toHaveLength(1)
    expect(costRows[0]).toMatchObject({
      agent: 'pixel',
      model: 'fallback/model',
      usageKind: 'tokens',
      totalTokens: 2,
      costUsdMicros: null,
      provider: null,
      lane: null,
    })
    expect(usageRows).toHaveLength(1)
  })

  it('rejects malformed counters as unknown without inventing a total', async () => {
    await meterAgentTurn({
      agent: 'pixel',
      activityClass: 'user',
      result: { id: 'm', usage: { input: -1, output: 2, cacheRead: Number.POSITIVE_INFINITY } },
    })

    expect(costRows[0]).toMatchObject({
      inputTokens: null,
      outputTokens: 2,
      cacheReadTokens: null,
      totalTokens: null,
    })
    expect(usageRows[0]).toMatchObject({ tokensOut: 2 })
    expect('tokensIn' in usageRows[0]).toBe(false)
    expect('tokensCacheRead' in usageRows[0]).toBe(false)
  })

  it('rejects malformed pricing as unpriced evidence', async () => {
    priceTurnImpl = () => ({ model: 'provider/model', costUsdMicros: -25 })
    await meterAgentTurn({
      agent: 'pixel',
      activityClass: 'user',
      result: { id: 'm', usage: { input: 1, output: 2 } },
    })

    expect(costRows[0].costUsdMicros).toBeNull()
    expect('costUsdMicros' in usageRows[0]).toBe(false)
  })
})

describe('meterImageTurn', () => {
  it('records an image spend event with cost from priceImage', async () => {
    priceImageImpl = () => ({ model: 'black-forest-labs/flux-pro', costUsdMicros: 110_000 })
    await meterImageTurn({ agent: 'pixel', activityClass: 'user', model: 'black-forest-labs/flux-pro', count: 2, taskId: 't1' })
    expect(costRows).toHaveLength(1)
    expect(costRows[0]).toMatchObject({
      agent: 'pixel',
      model: 'black-forest-labs/flux-pro',
      taskId: 't1',
      usageKind: 'media',
      totalTokens: null,
      costUsdMicros: 110_000,
    })
    expect(String(costRows[0].runId)).toStartWith('image:')
    expect(usageRows[0]).toMatchObject({ name: 'image', costUsdMicros: 110_000 })
  })

  it('records the run with null cost for a provider-priced model', async () => {
    priceImageImpl = () => ({ model: 'openai/gpt-image-2', costUsdMicros: null })
    await meterImageTurn({ agent: 'pixel', activityClass: 'user', model: 'openai/gpt-image-2', count: 1 })
    expect(costRows[0].costUsdMicros).toBeNull()
    expect(costRows[0].taskId).toBeNull()
  })

  it('persists the billing attribution from priceImage', async () => {
    priceImageImpl = () => ({ model: 'google/nanobanana', provider: 'google', lane: 'metered', costUsdMicros: 55_000 })
    await meterImageTurn({ agent: 'pixel', activityClass: 'user', model: 'google/nanobanana', count: 1 })
    expect(costRows[0]).toMatchObject({ provider: 'google', lane: 'metered' })
  })

  it('records an unpriced media row when image pricing fails', async () => {
    priceImageImpl = () => { throw new Error('catalog unavailable') }
    await meterImageTurn({ agent: 'pixel', activityClass: 'user', model: 'openai/gpt-image-2', count: 1 })

    expect(costRows).toHaveLength(1)
    expect(costRows[0]).toMatchObject({
      agent: 'pixel',
      model: 'openai/gpt-image-2',
      usageKind: 'media',
      totalTokens: null,
      costUsdMicros: null,
      provider: null,
      lane: null,
    })
    expect(usageRows).toHaveLength(1)
  })
})
