/**
 * Budget evaluation — pure policy logic. Given a policy and the spend in each
 * (scope, window), decide allow / warn / defer. No I/O; dispatch injects the
 * ledger-sourced spend numbers.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), 'bakin-test-budget')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { evaluateBudget, dayStartMs, monthStartMs, type BudgetPolicy, type BudgetSpend } from '../../src/core/budget'

const NO_SPEND: BudgetSpend = { globalDayMicros: 0, globalMonthMicros: 0, agentDayMicros: 0, agentMonthMicros: 0 }

describe('dayStartMs / monthStartMs', () => {
  it('day start is local midnight at or before now', () => {
    const now = Date.parse('2026-06-13T15:30:00')
    const ds = dayStartMs(now)
    expect(ds).toBeLessThanOrEqual(now)
    const d = new Date(ds)
    expect(d.getHours()).toBe(0)
    expect(d.getMinutes()).toBe(0)
  })
  it('month start is the 1st at local midnight', () => {
    const now = Date.parse('2026-06-13T15:30:00')
    const d = new Date(monthStartMs(now))
    expect(d.getDate()).toBe(1)
    expect(d.getHours()).toBe(0)
  })
})

describe('evaluateBudget', () => {
  it('allows when no caps are set', () => {
    expect(evaluateBudget({ policy: {}, agent: 'pixel', spend: NO_SPEND })).toEqual({ action: 'allow' })
  })

  it('allows when spend is below every cap and warn threshold', () => {
    const policy: BudgetPolicy = { global: { dailyUsd: 10 } }
    const spend = { ...NO_SPEND, globalDayMicros: 5_000_000 } // $5 of $10
    expect(evaluateBudget({ policy, agent: 'pixel', spend })).toEqual({ action: 'allow' })
  })

  it('warns at or above the warn threshold (default 80%)', () => {
    const policy: BudgetPolicy = { global: { dailyUsd: 10 } }
    const spend = { ...NO_SPEND, globalDayMicros: 8_500_000 } // $8.50 of $10 = 85%
    const r = evaluateBudget({ policy, agent: 'pixel', spend })
    expect(r.action).toBe('warn')
    if (r.action !== 'warn') return
    expect(r.scope).toBe('global')
    expect(r.window).toBe('daily')
    expect(r.capUsdMicros).toBe(10_000_000)
  })

  it('defers at or above 100% of a cap', () => {
    const policy: BudgetPolicy = { global: { dailyUsd: 10 } }
    const spend = { ...NO_SPEND, globalDayMicros: 10_000_000 }
    const r = evaluateBudget({ policy, agent: 'pixel', spend })
    expect(r.action).toBe('defer')
    if (r.action !== 'defer') return
    expect(r.scope).toBe('global')
    expect(r.window).toBe('daily')
  })

  it('defer beats warn when one cap warns and another is exceeded', () => {
    const policy: BudgetPolicy = { global: { dailyUsd: 100, monthlyUsd: 10 } }
    const spend = { ...NO_SPEND, globalDayMicros: 85_000_000, globalMonthMicros: 10_000_000 }
    expect(evaluateBudget({ policy, agent: 'pixel', spend }).action).toBe('defer')
  })

  it('applies per-agent caps to the named agent', () => {
    const policy: BudgetPolicy = { perAgent: { pixel: { dailyUsd: 2 } } }
    const spend = { ...NO_SPEND, agentDayMicros: 2_000_000 }
    const r = evaluateBudget({ policy, agent: 'pixel', spend })
    expect(r.action).toBe('defer')
    if (r.action !== 'defer') return
    expect(r.scope).toBe('agent')
  })

  it('honors a custom warnPct', () => {
    const policy: BudgetPolicy = { global: { dailyUsd: 10, warnPct: 0.5 } }
    const spend = { ...NO_SPEND, globalDayMicros: 5_000_000 } // 50%
    expect(evaluateBudget({ policy, agent: 'pixel', spend }).action).toBe('warn')
  })
})
