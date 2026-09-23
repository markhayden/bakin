/**
 * The spend policy file boundary (S13): absent = no limits; present but
 * unparseable/invalid = "we cannot know" — every read THROWS (the gate
 * then fails closed) and every write refuses to touch the bytes. Writers
 * are serialized and revision-checked at the final write boundary.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-spend-settings-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import { readLimits, readOverrides, readSpendSettings, spendRevision, withSpendPolicyWrite, SpendSettingsInvalidError, SpendRevisionStaleError, EMPTY_SPEND_SETTINGS } from '../../../plugins/spend/lib/settings'

const dir = join(testDir, 'plugin-settings')
const spendFile = join(dir, 'spend.json')
const valid = { limits: { rules: [{ id: 'g', scope: 'global', lane: 'metered', dailyCap: 10 }] }, billing: { overrides: [] } }

beforeEach(() => { mkdirSync(dir, { recursive: true }) })
afterEach(() => rmSync(testDir, { recursive: true, force: true }))

describe('reading the spend policy', () => {
  it('an absent file is the empty policy — no limits is a plain fact', () => {
    expect(readSpendSettings()).toEqual(EMPTY_SPEND_SETTINGS)
    expect(readLimits()).toEqual({ rules: [] })
    expect(readOverrides()).toEqual([])
  })

  it('a file that exists but is not valid JSON throws spend_settings_invalid naming the file (never "no limits")', () => {
    writeFileSync(spendFile, '{"limits":')
    expect(() => readLimits()).toThrow(SpendSettingsInvalidError)
    try { readLimits() } catch (err) { expect(err).toMatchObject({ code: 'spend_settings_invalid', file: spendFile }) }
  })

  it('a file that parses but fails the schema throws with the issues — an invalid BILLING section must not disable valid limits silently either', () => {
    writeFileSync(spendFile, JSON.stringify({ limits: { rules: [{ id: 'g', scope: 'global', lane: 'metered', dailyCap: '10' }] }, billing: { overrides: [] } }))
    expect(() => readLimits()).toThrow(/dailyCap/)
    writeFileSync(spendFile, JSON.stringify({ ...valid, billing: null }))
    expect(() => readOverrides()).toThrow(SpendSettingsInvalidError)
    expect(() => readLimits()).toThrow(SpendSettingsInvalidError)
  })
})

describe('withSpendPolicyWrite', () => {
  it('writes the mutated document and returns its new revision; the revision moves with every content change', async () => {
    const first = await withSpendPolicyWrite((current) => ({ next: { ...current, limits: { rules: valid.limits.rules as never } }, result: 'a' }))
    expect(first.result).toBe('a')
    expect(first.revision).toBe(spendRevision(readSpendSettings()))
    const second = await withSpendPolicyWrite((current) => ({ next: { ...current, billing: { overrides: [{ provider: 'google', lane: 'subscription' }] } }, result: null }))
    expect(second.revision).not.toBe(first.revision)
    expect(JSON.parse(readFileSync(spendFile, 'utf-8')).billing.overrides).toEqual([{ provider: 'google', lane: 'subscription' }])
  })

  it('refuses a stale expectRevision (409 material) and leaves the file alone', async () => {
    writeFileSync(spendFile, JSON.stringify(valid))
    const bytes = readFileSync(spendFile, 'utf-8')
    await expect(withSpendPolicyWrite((current) => ({ next: { ...current, limits: { rules: [] } }, result: null }), { expectRevision: 'stale' }))
      .rejects.toBeInstanceOf(SpendRevisionStaleError)
    expect(readFileSync(spendFile, 'utf-8')).toBe(bytes)
  })

  it('refuses to write over an invalid document — the operator\'s bytes survive every writer', async () => {
    const invalid = '{"limits":{"rules":[{"id":"g","scope":"global","lane":"metered","dailyCap":"10"}]},"billing":{"overrides":[]}}'
    writeFileSync(spendFile, invalid)
    await expect(withSpendPolicyWrite(() => ({ next: EMPTY_SPEND_SETTINGS, result: null }))).rejects.toBeInstanceOf(SpendSettingsInvalidError)
    expect(readFileSync(spendFile, 'utf-8')).toBe(invalid)
  })

  it('serializes writers: a writer that decided BEFORE an await sees the current document inside its turn (a raise cannot overwrite a concurrent PUT)', async () => {
    writeFileSync(spendFile, JSON.stringify(valid))
    // Writer A (a raise) enters after B's PUT landed; A must apply its cap to B's list, not the pre-B snapshot it read.
    const b = withSpendPolicyWrite((current) => ({ next: { ...current, limits: { rules: [...current.limits.rules, { id: 'p', scope: 'agent', scopeId: 'pixel', lane: 'metered', dailyCap: 1 }] as never } }, result: null }))
    const a = withSpendPolicyWrite((current) => ({ next: { ...current, limits: { rules: current.limits.rules.map((r) => (r.id === 'g' ? { ...r, dailyCap: 30 } : r)) as never } }, result: current.limits.rules.length }))
    await Promise.all([b, a])
    expect((await a).result).toBe(2)
    const rules = JSON.parse(readFileSync(spendFile, 'utf-8')).limits.rules as Array<{ id: string; dailyCap: number }>
    expect(rules.map((r) => [r.id, r.dailyCap])).toEqual([['g', 30], ['p', 1]])
  })

  it('the write itself is validated: a mutate that produces an invalid document throws and writes nothing', async () => {
    writeFileSync(spendFile, JSON.stringify(valid))
    const bytes = readFileSync(spendFile, 'utf-8')
    await expect(withSpendPolicyWrite((current) => ({ next: { ...current, limits: { rules: [{ id: 'x', scope: 'agent', lane: 'metered', dailyCap: 1 }] as never } }, result: null }))).rejects.toThrow(/scopeId/)
    expect(readFileSync(spendFile, 'utf-8')).toBe(bytes)
  })
})
