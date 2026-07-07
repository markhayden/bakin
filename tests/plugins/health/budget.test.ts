/**
 * Budget doctor check: ok when no caps or spend is low, warns as a global cap
 * is approached or runs were deferred, fails at/over a cap, errors when the
 * spend ledger is unreachable (gating fails closed without it).
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync, appendFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-budget-check-${Date.now()}-${randomUUID()}`)
let dbPath = join(testDir, 'bakin.db')

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, audit: join(testDir, 'audit.jsonl'), logs: join(testDir, 'logs'), db: dbPath }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

const loggerMock = () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

let budgetPolicy: unknown = {}
const hookRegistryMock = () => ({
  getHookRegistry: () => ({ invoke: async (name: string) => (name === 'models.getBudgetPolicy' ? budgetPolicy : undefined) }),
})
// getHookRegistry lives in the leaf module post-WS2 K1; mock the leaf + legacy facade.
mock.module('@bakin/core/hooks/hook-registry-singleton', hookRegistryMock)
mock.module('../../../src/core/plugin-registry', hookRegistryMock)

import { checkBudget } from '@bakin/health/lib/system-checks/budget'
import { recordRunCost } from '../../../src/core/execution-ledger'
import { closeDb } from '../../../packages/core/src/storage/db'

beforeEach(() => {
  mkdirSync(testDir, { recursive: true })
  dbPath = join(testDir, 'bakin.db')
  budgetPolicy = {}
})

afterEach(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

function seedSpend(costUsdMicros: number): void {
  recordRunCost({ runId: `seed:${randomUUID()}`, taskId: 't', agent: 'pixel', model: 'm', inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsdMicros, occurredAt: Date.now() })
}

describe('budget health check', () => {
  it('is ok when no caps are configured', async () => {
    const [r] = await checkBudget()
    expect(r.status).toBe('ok')
    expect(r.message).toContain('No budget caps')
  })

  it('is ok when spend is well under the cap', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 100 }] }
    seedSpend(5_000_000) // $5 of $100
    const [r] = await checkBudget()
    expect(r.status).toBe('ok')
  })

  it('warns as spend approaches the cap (>= warnPct)', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 10 }] }
    seedSpend(8_500_000) // $8.50 of $10 = 85%
    const [r] = await checkBudget()
    expect(r.status).toBe('warn')
  })

  it('errors at/over the cap (dispatch blocked)', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 10 }] }
    seedSpend(10_000_000)
    const [r] = await checkBudget()
    expect(r.status).toBe('error')
  })

  it('warns when runs were deferred even if utilization looks ok', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 1000 }] }
    appendFileSync(join(testDir, 'audit.jsonl'), JSON.stringify({ ts: new Date().toISOString(), event: 'budget.deferred', agent: 'pixel', data: {} }) + '\n', 'utf-8')
    const [r] = await checkBudget()
    expect(r.status).toBe('warn')
  })

  it('errors when the ledger is unreachable', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 10 }] }
    closeDb()
    mkdirSync(join(testDir, 'blocked.db'), { recursive: true }) // a dir where the db file should be
    dbPath = join(testDir, 'blocked.db')
    const [r] = await checkBudget()
    expect(r.status).toBe('error')
  })
})
