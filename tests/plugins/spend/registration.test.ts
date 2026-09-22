/**
 * Spend plugin activation: it owns the budget health check and its two
 * repairs, the five spend.* hooks, and the spend/limits/status/incidents/
 * billing routes (the ownership cutover). A fresh install gets an empty,
 * valid spend.json at activation.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-spend-registration-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import spendPlugin from '../../../plugins/spend'
import { activatePlugin } from '../test-helpers'
import { readPluginSettings } from '../../../packages/core/src/plugins/settings-store'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('spend plugin registration', () => {
  it('owns the budget check, both spend repairs, the five spend.* hooks and its routes; initializes spend.json', async () => {
    const { ctx, routes } = await activatePlugin(spendPlugin, testDir)
    const checks = (ctx.registerHealthCheck as ReturnType<typeof mock>).mock.calls.map((c) => (c[0] as { id: string }).id)
    const repairs = (ctx.registerHealthRepairAction as ReturnType<typeof mock>).mock.calls.map((c) => (c[0] as { id: string }).id)
    expect(checks).toEqual(['budget'])
    expect(repairs.sort()).toEqual(['accept-unattributed-history', 'spend-evidence-refresh-pricing'])
    const hooks = (ctx.hooks.register as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string)
    expect(hooks.sort()).toEqual(['spend.getBudgetPolicy', 'spend.priceImage', 'spend.priceTurn', 'spend.resolveBilling', 'spend.updateBudgetPolicy'])
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      'GET /coverage', 'GET /incidents', 'GET /limits', 'GET /spend', 'GET /status',
      'POST /incidents/:id/resolve', 'PUT /billing/overrides', 'PUT /limits',
    ])
    expect(readPluginSettings<Record<string, unknown>>('spend')).toEqual({ limits: { rules: [] }, billing: { overrides: [] } })
  })
})
