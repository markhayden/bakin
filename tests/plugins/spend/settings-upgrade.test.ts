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

  it('a valid pre-v2 budget ({ global, perAgent } metered dollars) is mapped into rules — a box that skipped releases keeps its caps', () => {
    writeFileSync(modelsFile, JSON.stringify({ budget: { global: { dailyUsd: 10, monthlyUsd: 200, warnPct: 0.8 }, perAgent: { pixel: { monthlyUsd: 50 }, idle: {} } } }))
    expect(upgradeSpendSettings()).toEqual({ status: 'upgraded', rules: 2 })
    const spend = readPluginSettings<{ limits: { rules: Array<Record<string, unknown>> } }>('spend')
    expect(spend.limits.rules.map(({ id: _id, ...r }) => r)).toEqual([
      { scope: 'global', lane: 'metered', dailyCap: 10, monthlyCap: 200 },
      { scope: 'agent', scopeId: 'pixel', lane: 'metered', monthlyCap: 50 },
    ])
    expect(readPluginSettings<Record<string, unknown>>('models').budget).toBeUndefined()
    expect(existsSync(backupFile)).toBe(true)
  })

  it('an UNREADABLE models.json blocks the upgrade: nothing written, no backup, no empty completion marker', () => {
    writeFileSync(modelsFile, '{"budget":')
    const result = upgradeSpendSettings()
    expect(result.status).toBe('blocked')
    expect(existsSync(spendFile)).toBe(false)
    expect(existsSync(backupFile)).toBe(false)
    expect(readFileSync(modelsFile, 'utf-8')).toBe('{"budget":')
    // Restored source ⇒ the real upgrade runs, with its backup.
    writeFileSync(modelsFile, JSON.stringify(legacyModels))
    expect(upgradeSpendSettings()).toEqual({ status: 'upgraded', rules: 2 })
    expect(JSON.parse(readFileSync(backupFile, 'utf-8'))).toEqual(legacyModels)
  })

  it('a present-but-invalid spend.json is never overwritten (blocked, bytes untouched) — the operator\'s limits are still in it', () => {
    writeFileSync(modelsFile, '{}')
    const invalid = '{"limits":{"rules":[{"id":"g","scope":"global","lane":"metered","dailyCap":10}]},"billing":null}'
    writeFileSync(spendFile, invalid)
    const result = upgradeSpendSettings()
    expect(result.status).toBe('blocked')
    expect(readFileSync(spendFile, 'utf-8')).toBe(invalid)
    expect(existsSync(backupFile)).toBe(false)
  })

  it('a valid destination WITHOUT the backup means the source keys were never migrated: they are merged in, not stripped away', () => {
    // An earlier boot initialized an empty spend.json (e.g. the source was
    // unreadable then); the operator has since restored models.json.
    writeFileSync(spendFile, JSON.stringify({ limits: { rules: [{ id: 'kept', scope: 'provider', scopeId: 'google', lane: 'metered', dailyCap: 3 }] }, billing: { overrides: [] } }))
    writeFileSync(modelsFile, JSON.stringify(legacyModels))
    const result = upgradeSpendSettings()
    expect(result).toEqual({ status: 'upgraded', rules: 3, merged: true })
    const spend = readPluginSettings<{ limits: { rules: Array<{ id: string; scope: string }> }; billing: { overrides: unknown[] } }>('spend')
    expect(spend.limits.rules.map((r) => r.scope)).toEqual(['provider', 'global', 'agent'])
    expect(spend.billing.overrides).toEqual([{ agentId: 'pixel', lane: 'subscription' }])
    expect(readPluginSettings<Record<string, unknown>>('models').budget).toBeUndefined()
    expect(JSON.parse(readFileSync(backupFile, 'utf-8'))).toEqual(legacyModels)
  })

  it('legacy rules that duplicate an identity collapse to the first (one rule per scope+lane), reported as skipped', () => {
    writeFileSync(modelsFile, JSON.stringify({ budget: { rules: [
      { scope: 'global', lane: 'metered', dailyCap: 5 },
      { scope: 'global', lane: 'metered', monthlyCap: 50 },
    ] } }))
    const result = upgradeSpendSettings()
    expect(result).toEqual({ status: 'upgraded', rules: 1, skipped: [{ index: 1, reason: expect.stringContaining('duplicates') }] })
  })
})
