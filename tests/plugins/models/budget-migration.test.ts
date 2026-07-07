/**
 * One-shot legacy-budget migration (PR #500 {global, perAgent} → v2 rules).
 * Pure mapper — the activate() wiring just calls it once and writes back.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), 'bakin-test-budget-migration')
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { isLegacyBudget, migrateLegacyBudget } from '../../../plugins/models/lib/budget-migration'

describe('isLegacyBudget', () => {
  it('detects the pre-v2 shape and nothing else', () => {
    expect(isLegacyBudget({ global: { dailyUsd: 10 } })).toBe(true)
    expect(isLegacyBudget({ perAgent: { pixel: { monthlyUsd: 5 } } })).toBe(true)
    expect(isLegacyBudget({ rules: [] })).toBe(false)
    expect(isLegacyBudget({})).toBe(false)
    expect(isLegacyBudget(undefined)).toBe(false)
    expect(isLegacyBudget(null)).toBe(false)
  })
})

describe('migrateLegacyBudget', () => {
  it('maps global + per-agent metered dollar caps to rules', () => {
    const migrated = migrateLegacyBudget({
      global: { dailyUsd: 25, monthlyUsd: 300, warnPct: 0.7 },
      perAgent: { pixel: { dailyUsd: 5 }, rolo: { monthlyUsd: 50 }, empty: {} },
    })
    expect(migrated.rules).toEqual([
      { scope: 'global', lane: 'metered', dailyCap: 25, monthlyCap: 300, warnPct: 0.7 },
      { scope: 'agent', scopeId: 'pixel', lane: 'metered', dailyCap: 5 },
      { scope: 'agent', scopeId: 'rolo', lane: 'metered', monthlyCap: 50 },
    ])
  })

  it('maps an empty legacy policy to zero rules', () => {
    expect(migrateLegacyBudget({}).rules).toEqual([])
    expect(migrateLegacyBudget({ global: {} }).rules).toEqual([])
  })
})
