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
    await meterAgentTurn({ agent: 'main', result: { id: 'm', usage: { input: 100, output: 50, total: 150 } }, name: 'watchdog-alert' })
    expect(costRows).toHaveLength(1)
    expect(costRows[0].taskId).toBeNull()
    expect(String(costRows[0].runId)).toStartWith('turn:')
    expect(costRows[0].costUsdMicros).toBe(4200)
    expect(usageRows[0]).toMatchObject({ kind: 'agent', name: 'watchdog-alert', tokensIn: 100, tokensOut: 50, costUsdMicros: 4200 })
  })

  it('uses the dispatch runId + taskId when provided', async () => {
    await meterAgentTurn({ runId: 'task:t1:d1', taskId: 't1', agent: 'pixel', result: { id: 'm', usage: { input: 1, output: 1 } } })
    expect(costRows[0].runId).toBe('task:t1:d1')
    expect(costRows[0].taskId).toBe('t1')
  })

  it('prices the model the runtime actually ran, not the requested override', async () => {
    // Runtime reports it ran modelY; routing had requested modelX.
    const seen: Record<string, unknown>[] = []
    priceTurnImpl = (d) => { seen.push(d); return { model: d.model as string, costUsdMicros: 999 } }
    await meterAgentTurn({ agent: 'pixel', resolvedModel: 'modelX', result: { id: 'm', usage: { input: 1, output: 1, model: 'modelY' } } })
    expect(seen[0].model).toBe('modelY') // priced against what ran
    expect(costRows[0].model).toBe('modelY')
  })

  it('records null cost (unmetered) when pricing is unavailable, never throws', async () => {
    priceTurnImpl = () => { throw new Error('boom') }
    await meterAgentTurn({ agent: 'pixel', result: { id: 'm', usage: { input: 1, output: 1 } } })
    // priceTurn threw → whole meter swallowed; no row, no throw.
    expect(costRows).toHaveLength(0)
  })
})

describe('meterImageTurn', () => {
  it('records an image spend event with cost from priceImage', async () => {
    priceImageImpl = () => ({ model: 'black-forest-labs/flux-pro', costUsdMicros: 110_000 })
    await meterImageTurn({ agent: 'pixel', model: 'black-forest-labs/flux-pro', count: 2, taskId: 't1' })
    expect(costRows).toHaveLength(1)
    expect(costRows[0]).toMatchObject({ agent: 'pixel', model: 'black-forest-labs/flux-pro', taskId: 't1', costUsdMicros: 110_000 })
    expect(String(costRows[0].runId)).toStartWith('image:')
    expect(usageRows[0]).toMatchObject({ name: 'image', costUsdMicros: 110_000 })
  })

  it('records the run with null cost for a provider-priced model', async () => {
    priceImageImpl = () => ({ model: 'openai/gpt-image-2', costUsdMicros: null })
    await meterImageTurn({ agent: 'pixel', model: 'openai/gpt-image-2', count: 1 })
    expect(costRows[0].costUsdMicros).toBeNull()
    expect(costRows[0].taskId).toBeNull()
  })
})
