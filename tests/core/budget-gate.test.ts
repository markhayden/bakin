/**
 * budgetGate — the dispatch-side budget consultation. Focused on the paths
 * the pure evaluator can't cover: reading the policy via hook, summing ledger
 * spend, and FAIL-CLOSED behavior when the spend read throws (defer, not
 * allow). The allow/warn/defer arithmetic itself lives in budget.test.ts.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const dir = join(tmpdir(), 'bakin-test-budget-gate')

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => dir,
  getBakinPaths: () => ({ root: dir, home: dir, db: join(dir, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => dir,
  getBakinPaths: () => ({ root: dir, home: dir, db: join(dir, 'bakin.db') }),
}))
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))

const auditCalls: Array<[string, string, string, Record<string, unknown>]> = []
mock.module('../../src/core/audit', () => ({ appendAudit: (...a: unknown[]) => { auditCalls.push(a as never) } }))

// App-services / task-store / openclaw-home are imported transitively by
// dispatch at load — stub them so importing dispatch is side-effect-free.
mock.module('../../src/core/app-services', () => ({ getAppServices: () => ({ runtime: { messaging: { send: async () => ({ id: 'm' }) }, agents: { list: async () => [] } } }) }))
mock.module('@/core/app-services', () => ({ getAppServices: () => ({ runtime: { messaging: { send: async () => ({ id: 'm' }) }, agents: { list: async () => [] } } }) }))
mock.module('../../src/core/task-store', () => ({ readTaskboard: () => ({ columns: {} }), addTaskLog: async () => {}, updateTask: async () => {}, moveTask: async () => {}, blockTask: async () => {} }))
mock.module('@/core/task-store', () => ({ readTaskboard: () => ({ columns: {} }), addTaskLog: async () => {}, updateTask: async () => {}, moveTask: async () => {}, blockTask: async () => {} }))
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => dir, getOpenClawPath: (s: string) => join(dir, s) }))

// The two seams under test.
let budgetPolicy: unknown = {}
const hookRegistryMock = () => ({
  getHookRegistry: () => ({ invoke: async (name: string) => (name === 'models.getBudgetPolicy' ? budgetPolicy : undefined) }),
})
// getHookRegistry lives in the leaf module post-WS2 K1; mock the leaf + legacy facade.
mock.module('@bakin/core/hooks/hook-registry-singleton', hookRegistryMock)
mock.module('../../src/core/plugin-registry', hookRegistryMock)

let spendThrows = false
mock.module('../../src/core/execution-ledger', () => ({
  // dispatch imports several verbs at load; only spendTotal matters here.
  claimNextRun: () => ({ claimed: false }),
  currentSeq: () => 0,
  loseRun: () => true,
  settleRun: () => true,
  recordRunCost: () => {},
  spendTotal: () => { if (spendThrows) throw new Error('ledger down'); return 0 },
}))

import { budgetGate } from '../../src/core/dispatch'

beforeEach(() => {
  budgetPolicy = {}
  spendThrows = false
  auditCalls.length = 0
})

describe('budgetGate', () => {
  it('allows when no policy is configured', async () => {
    expect((await budgetGate('pixel', dir)).action).toBe('allow')
  })

  it('allows when caps are set but spend is zero', async () => {
    budgetPolicy = { global: { dailyUsd: 10 } }
    expect((await budgetGate('pixel', dir)).action).toBe('allow')
  })

  it('FAIL-CLOSED: defers and audits when the spend read throws', async () => {
    budgetPolicy = { global: { dailyUsd: 10 } }
    spendThrows = true
    const decision = await budgetGate('pixel', dir)
    expect(decision.action).toBe('defer')
    expect(auditCalls.some((c) => c[1] === 'budget.deferred')).toBe(true)
  })
})
