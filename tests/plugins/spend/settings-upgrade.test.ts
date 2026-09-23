/**
 * Spend settings upgrade (spec §10, plan T2.7): one-shot, crash-safe,
 * idempotent move of the budget + billing keys out of models.json into
 * spend.json. Destination validity is the completion marker; the backup is
 * written once and never overwritten; every rule gets an id; warnPct is
 * dropped; a crash between the two writes resumes without data loss.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-spend-upgrade-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import { upgradeSpendSettings } from '../../../plugins/spend/lib/settings-upgrade'
import { readPluginSettings } from '../../../packages/core/src/plugins/settings-store'

const dir = join(testDir, 'plugin-settings')
const modelsFile = join(dir, 'models.json')
const spendFile = join(dir, 'spend.json')
const backupFile = join(dir, 'models.json.pre-spend.bak')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const legacyModels = {
  routing: { routes: [{ workClass: 'workflow', model: 'anthropic/claude-sonnet-4-6' }], tagOverrides: [] },
  budget: {
    rules: [
      { scope: 'global', lane: 'metered', dailyCap: 10, warnPct: 0.8, atCap: 'defer' },
      { scope: 'agent', scopeId: 'pixel', lane: 'subscription', monthlyCap: 5_000_000, atCap: 'pause' },
    ],
    acceptUnattributedBefore: '2026-09-01',
  },
  billing: { overrides: [{ agentId: 'pixel', lane: 'subscription' }] },
}

beforeEach(() => {
  mkdirSync(dir, { recursive: true })
})
afterEach(() => rmSync(testDir, { recursive: true, force: true }))

describe('upgradeSpendSettings', () => {
  it('moves budget + billing into spend.json with ids, drops warnPct, backs up once, strips the source keys', () => {
    writeFileSync(modelsFile, JSON.stringify(legacyModels))
    const result = upgradeSpendSettings()
    expect(result).toEqual({ status: 'upgraded', rules: 2 })

    const spend = readPluginSettings<{ limits: { rules: Array<Record<string, unknown>>; acceptUnattributedBefore?: string }; billing: { overrides: unknown[] } }>('spend')
    expect(spend.limits.rules).toHaveLength(2)
    for (const rule of spend.limits.rules) {
      expect(rule.id).toMatch(UUID_RE)
      expect('warnPct' in rule).toBe(false)
    }
    expect(spend.limits.rules[1]).toMatchObject({ scope: 'agent', scopeId: 'pixel', lane: 'subscription', monthlyCap: 5_000_000, atCap: 'pause' })
    expect(spend.limits.acceptUnattributedBefore).toBe('2026-09-01')
    expect(spend.billing.overrides).toEqual([{ agentId: 'pixel', lane: 'subscription' }])

    const models = JSON.parse(readFileSync(modelsFile, 'utf-8')) as Record<string, unknown>
    expect(models).toEqual({ routing: legacyModels.routing })
    expect(JSON.parse(readFileSync(backupFile, 'utf-8'))).toEqual(legacyModels)
  })

  it('is a no-op once spend.json is valid, and never overwrites the backup', () => {
    writeFileSync(modelsFile, JSON.stringify(legacyModels))
    upgradeSpendSettings()
    const firstSpend = readFileSync(spendFile, 'utf-8')
    writeFileSync(backupFile, '{"sentinel":true}')
    expect(upgradeSpendSettings()).toEqual({ status: 'noop' })
    expect(readFileSync(spendFile, 'utf-8')).toBe(firstSpend)
    expect(readFileSync(backupFile, 'utf-8')).toBe('{"sentinel":true}')
  })

  it('a fresh install (no models.json budget) gets an empty, valid spend document and no backup', () => {
    writeFileSync(modelsFile, JSON.stringify({ routing: { routes: [], tagOverrides: [] } }))
    expect(upgradeSpendSettings()).toEqual({ status: 'initialized' })
    expect(readPluginSettings<Record<string, unknown>>('spend')).toEqual({ limits: { rules: [] }, billing: { overrides: [] } })
    expect(existsSync(backupFile)).toBe(false)
  })

  it('resumes after a crash between writing spend.json and stripping models.json: source keys are removed, spend.json untouched', () => {
    writeFileSync(modelsFile, JSON.stringify(legacyModels))
    upgradeSpendSettings()
    const upgraded = readFileSync(spendFile, 'utf-8')
    // Simulate the crash: the destination is valid but models.json still carries the keys.
    writeFileSync(modelsFile, JSON.stringify(legacyModels))
    expect(upgradeSpendSettings()).toEqual({ status: 'resumed' })
    expect(readFileSync(spendFile, 'utf-8')).toBe(upgraded)
    expect(JSON.parse(readFileSync(modelsFile, 'utf-8'))).toEqual({ routing: legacyModels.routing })
  })

  it('keeps ids already present and refuses to invent structure for an invalid legacy rule (reported, not silently dropped)', () => {
    writeFileSync(modelsFile, JSON.stringify({
      budget: { rules: [{ id: 'keep-me', scope: 'global', lane: 'metered', dailyCap: 1 }, { scope: 'agent', lane: 'metered', dailyCap: 1 }] },
    }))
    const result = upgradeSpendSettings()
    expect(result).toEqual({ status: 'upgraded', rules: 1, skipped: [{ index: 1, reason: expect.stringContaining('scopeId') }] })
    const spend = readPluginSettings<{ limits: { rules: Array<{ id: string }> } }>('spend')
    expect(spend.limits.rules.map((r) => r.id)).toEqual(['keep-me'])
  })
})
