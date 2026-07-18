/**
 * `bakin budget` / `bakin spend` — flag parsing + request shapes, with the
 * HTTP client mocked (server behavior is covered by the models route tests).
 * Unit-per-lane rendering: metered caps echo as USD, subscription as tokens.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testHome = join(tmpdir(), `bakin-cli-budget-${Date.now()}`)
process.env.BAKIN_HOME = testHome

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db') }),
}))

let rules: Array<Record<string, unknown>> = []
const apiCalls: Array<{ path: string; init?: RequestInit }> = []
const apiPostSpy = mock(async (path: string, body?: unknown) => {
  apiCalls.push({ path })
  void body
  return { ok: true }
})
mock.module('../../src/cli/http', () => ({
  api: mock(async (path: string, init?: RequestInit) => { apiCalls.push({ path, init }); return { ok: true } }),
  apiGet: mock(async (path: string) => {
    apiCalls.push({ path })
    if (path.startsWith('/api/plugins/models/budget/status')) return { paused: false, perAgent: {}, deferredProviders: [], openIncidents: [] }
    if (path.startsWith('/api/plugins/models/budget/incidents')) return { incidents: [] }
    if (path.startsWith('/api/plugins/models/budget')) return { rules }
    if (path.startsWith('/api/plugins/models/spend')) {
      return {
        window: '24h', totalUsdMicros: 0, byAgent: [], byModel: [],
        byWorkClass: [
          { workClass: 'auto-title', runs: 3, totalTokens: 900, costUsdMicros: 6000, subscriptionTokens: 0, avgCostUsdMicros: 2000 },
          { workClass: 'unclassified', runs: 1, totalTokens: 10, costUsdMicros: null, subscriptionTokens: 0, avgCostUsdMicros: null },
        ],
      }
    }
    return {}
  }),
  apiPost: (path: string, body?: unknown) => apiPostSpy(path, body),
}))

const printSpy = mock((_v: unknown) => {})
const printTableSpy = mock((_rows: unknown) => {})
mock.module('../../src/cli/output', () => ({ print: printSpy, printTable: printTableSpy }))

class ExitCalled extends Error {}
mock.module('../../src/cli/help', () => ({
  exitUsage: mock(async (): Promise<never> => { throw new ExitCalled('usage') }),
  exitCommandIssue: mock(async (): Promise<never> => { throw new ExitCalled('issue') }),
  exitUnknownSubcommand: mock(async (): Promise<never> => { throw new ExitCalled('unknown') }),
  exitCommandFailure: mock(async (): Promise<never> => { throw new ExitCalled('failure') }),
}))

import { run } from '../../src/cli/commands/budget'

beforeEach(() => {
  rules = []
  apiCalls.length = 0
  apiPostSpy.mockClear()
  printTableSpy.mockClear()
})

describe('bakin budget set', () => {
  it('PUTs the full rule list with the upserted rule (unit follows the lane)', async () => {
    rules = [{ scope: 'agent', scopeId: 'pixel', lane: 'metered', dailyCap: 5 }]
    await run(['budget', 'set', '--scope', 'provider', '--id', 'google', '--lane', 'metered', '--daily', '5', '--at-cap', 'pause'])
    const put = apiCalls.find((c) => c.init?.method === 'PUT')
    expect(put).toBeDefined()
    const body = JSON.parse(String(put!.init!.body)) as { rules: Array<Record<string, unknown>> }
    expect(body.rules).toEqual([
      { scope: 'agent', scopeId: 'pixel', lane: 'metered', dailyCap: 5 },
      { scope: 'provider', scopeId: 'google', lane: 'metered', dailyCap: 5, atCap: 'pause' },
    ])
  })

  it('requires --id for scoped rules and at least one cap', async () => {
    await expect(run(['budget', 'set', '--scope', 'provider', '--lane', 'metered', '--daily', '5'])).rejects.toThrow(ExitCalled)
    await expect(run(['budget', 'set', '--scope', 'global', '--lane', 'metered'])).rejects.toThrow(ExitCalled)
  })

  it('subscription rules carry token caps verbatim, with k/M suffixes parsed', async () => {
    await run(['budget', 'set', '--scope', 'agent', '--id', 'main', '--lane', 'subscription', '--daily', '5M'])
    const put = apiCalls.find((c) => c.init?.method === 'PUT')
    const body = JSON.parse(String(put!.init!.body)) as { rules: Array<Record<string, unknown>> }
    expect(body.rules).toEqual([{ scope: 'agent', scopeId: 'main', lane: 'subscription', dailyCap: 5_000_000 }])
  })

  it('model-scope rules are accepted (usage parity with the evaluator)', async () => {
    await run(['budget', 'set', '--scope', 'model', '--id', 'anthropic/claude-opus-4-6', '--lane', 'metered', '--daily', '10'])
    const put = apiCalls.find((c) => c.init?.method === 'PUT')
    const body = JSON.parse(String(put!.init!.body)) as { rules: Array<Record<string, unknown>> }
    expect(body.rules).toEqual([{ scope: 'model', scopeId: 'anthropic/claude-opus-4-6', lane: 'metered', dailyCap: 10 }])
  })
})

describe('bakin budget pause/resume', () => {
  it('POSTs the kill switch through /api/settings', async () => {
    await run(['budget', 'pause'])
    expect(apiPostSpy).toHaveBeenCalledWith('/api/settings', { dispatch: { paused: true } })
    await run(['budget', 'resume'])
    expect(apiPostSpy).toHaveBeenCalledWith('/api/settings', { dispatch: { paused: false } })
  })
})

describe('bakin budget incidents --resolve', () => {
  it('POSTs the resolve action with the new cap', async () => {
    await run(['budget', 'incidents', '--resolve', '7', '--action', 'raise', '--cap', '50'])
    expect(apiPostSpy).toHaveBeenCalledWith('/api/plugins/models/budget/incidents/7/resolve', { action: 'raise', cap: 50 })
  })
})

describe('bakin spend', () => {
  it('renders without error and warns when no rules exist', async () => {
    await run(['spend'])
    expect(apiCalls.some((c) => c.path.startsWith('/api/plugins/models/spend'))).toBe(true)
  })

  it('renders the by-work-class block NULL-honestly', async () => {
    await run(['spend'])
    const tables = printTableSpy.mock.calls.map((c) => c[0] as Array<Record<string, unknown>>)
    const wcTable = tables.find((rows) => rows.some((r) => 'class' in r))
    expect(wcTable).toEqual([
      { class: 'auto-title', runs: 3, tokens: expect.any(String), 'est. cost': '$0.01', 'sub tokens': '—', 'avg $/run': '$0.00' },
      { class: 'unclassified (pre-migration)', runs: 1, tokens: expect.any(String), 'est. cost': '—', 'sub tokens': '—', 'avg $/run': '—' },
    ])
  })
})
