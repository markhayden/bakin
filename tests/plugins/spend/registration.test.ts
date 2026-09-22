/**
 * Spend plugin activation: it owns the budget health check and its two
 * repairs (moved out of the health plugin in the spend ownership series),
 * registers nothing else yet, and contributes no routes until the
 * ownership cutover.
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

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('spend plugin registration', () => {
  it('owns the budget check and both spend repairs; contributes no routes yet', async () => {
    const { ctx, routes } = await activatePlugin(spendPlugin, testDir)
    const checks = (ctx.registerHealthCheck as ReturnType<typeof mock>).mock.calls.map((c) => (c[0] as { id: string }).id)
    const repairs = (ctx.registerHealthRepairAction as ReturnType<typeof mock>).mock.calls.map((c) => (c[0] as { id: string }).id)
    expect(checks).toEqual(['budget'])
    expect(repairs.sort()).toEqual(['accept-unattributed-history', 'spend-evidence-refresh-pricing'])
    expect(routes).toEqual([])
  })
})
