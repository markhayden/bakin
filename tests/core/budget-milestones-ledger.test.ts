/**
 * Ledger v10 (spend plan T2.6): `budget_milestones` keyed by rule id, and
 * `budget_incidents` gaining episode / event_id / notified_at. The row id
 * alone never identifies an alert — every open/reopen mints a new event id,
 * and delivery marks name the exact `(id, event_id)` they delivered so a
 * slow delivery completing after a reopen cannot swallow the new episode.
 * Reopen set is raised | window_rollover | rule_removed (S14): a deleted
 * and recreated pause rule breaching again in the same window alerts again
 * and its pause hold survives rollover.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { rmSync, mkdirSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-budget-milestones-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { closeDb } from '../../packages/core/src/storage/db'
import {
  acknowledgeMilestone,
  listBudgetIncidents,
  listMilestones,
  listUnnotifiedIncidents,
  listUnnotifiedMilestones,
  markIncidentNotified,
  markMilestoneNotified,
  openBudgetIncident,
  recordMilestoneCrossings,
  resolveBudgetIncident,
  resolveExpiredBudgetIncidents,
} from '../../src/core/execution-ledger'

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

const W0 = 1_700_000_000_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function capInput(scopeId: string, extra: Partial<Parameters<typeof openBudgetIncident>[0]> = {}) {
  return {
    scope: 'agent' as const, scopeId, lane: 'metered' as const, window: 'daily' as const,
    windowStartMs: W0, kind: 'cap' as const, unit: 'usd_micros' as const,
    capValue: 10_000_000, spentValue: 11_000_000, atCap: 'defer' as const, openedAt: W0 + 1,
    ...extra,
  }
}

describe('incident episodes (D28)', () => {
  it('a fresh open is episode 1 with a minted event id and nothing delivered yet', () => {
    const { opened, id } = openBudgetIncident(capInput('ep-fresh'))
    expect(opened).toBe(true)
    const row = listBudgetIncidents({}).find((i) => i.id === id)!
    expect(row.episode).toBe(1)
    expect(row.eventId).toMatch(UUID_RE)
    expect(row.notifiedAt).toBeNull()
  })

  it('a reopen after a raise bumps the episode, mints a NEW event id, clears notified_at and takes the new reaction', () => {
    const { id } = openBudgetIncident(capInput('ep-raise'))
    const first = listBudgetIncidents({}).find((i) => i.id === id)!
    expect(markIncidentNotified(id, first.eventId!)).toBe(1)
    resolveBudgetIncident({ id, status: 'resolved', resolution: 'raised' })

    const reopened = openBudgetIncident(capInput('ep-raise', { capValue: 20_000_000, spentValue: 21_000_000, atCap: 'pause', openedAt: W0 + 50 }))
    expect(reopened).toEqual({ opened: true, id })
    const second = listBudgetIncidents({}).find((i) => i.id === id)!
    expect(second.episode).toBe(2)
    expect(second.eventId).toMatch(UUID_RE)
    expect(second.eventId).not.toBe(first.eventId)
    expect(second.notifiedAt).toBeNull()
    expect(second.atCap).toBe('pause')
  })

  it("'resumed' is reopenable and 'acknowledged' is not: resume clears a hold while under the cap, so going over again is a NEW episode (a pause rule re-engages); a dismissed breach stays quiet", () => {
    const { id } = openBudgetIncident(capInput('ep-resume', { atCap: 'pause' }))
    resolveBudgetIncident({ id, status: 'resolved', resolution: 'resumed' })
    const reopened = openBudgetIncident(capInput('ep-resume', { atCap: 'pause', openedAt: W0 + 60 }))
    expect(reopened).toEqual({ opened: true, id })
    expect(listBudgetIncidents({}).find((i) => i.id === id)!.episode).toBe(2)

    const { id: dismissed } = openBudgetIncident(capInput('ep-ack'))
    resolveBudgetIncident({ id: dismissed, status: 'resolved', resolution: 'acknowledged' })
    expect(openBudgetIncident(capInput('ep-ack', { openedAt: W0 + 60 }))).toEqual({ opened: false, id: dismissed })
  })

  it('a delivery mark names its event: the stale episode-1 event changes zero rows after a reopen', () => {
    const { id } = openBudgetIncident(capInput('ep-stale'))
    const first = listBudgetIncidents({}).find((i) => i.id === id)!
    resolveBudgetIncident({ id, status: 'resolved', resolution: 'raised' })
    openBudgetIncident(capInput('ep-stale', { capValue: 20_000_000, spentValue: 21_000_000, openedAt: W0 + 60 }))

    // Episode 1's slow delivery completes now — it must not mark episode 2.
    expect(markIncidentNotified(id, first.eventId!)).toBe(0)
    const pending = listUnnotifiedIncidents()
    expect(pending.map((i) => i.id)).toContain(id)
    const second = pending.find((i) => i.id === id)!
    expect(second.episode).toBe(2)
    expect(markIncidentNotified(id, second.eventId!)).toBe(1)
    expect(listUnnotifiedIncidents().some((i) => i.id === id)).toBe(false)
  })

  it("an 'acknowledged'-resolved incident stays suppressed (no new episode)", () => {
    const { id } = openBudgetIncident(capInput('ep-ack'))
    resolveBudgetIncident({ id, status: 'resolved', resolution: 'acknowledged' })
    expect(openBudgetIncident(capInput('ep-ack', { openedAt: W0 + 70 })).opened).toBe(false)
    expect(listBudgetIncidents({}).find((i) => i.id === id)!.episode).toBe(1)
  })

  it('S14: delete a pause rule → recreate → re-breach reopens with a new episode, and the pause hold survives rollover', () => {
    const { id } = openBudgetIncident(capInput('s14', { atCap: 'pause' }))
    // Deleting the rule resolves its incident.
    resolveBudgetIncident({ id, status: 'resolved', resolution: 'rule_removed' })
    // Recreated rule (same scope, same window) breaches again.
    const again = openBudgetIncident(capInput('s14', { atCap: 'pause', openedAt: W0 + 90 }))
    expect(again).toEqual({ opened: true, id })
    const row = listBudgetIncidents({ openOnly: true }).find((i) => i.id === id)!
    expect(row.episode).toBe(2)
    expect(row.notifiedAt).toBeNull()
    // Rollover sweeps defer-mode incidents only — the recreated pause hold persists.
    resolveExpiredBudgetIncidents({ dailyWindowStartMs: W0 + 86_400_000, monthlyWindowStartMs: W0 + 86_400_000, now: W0 + 86_400_001 })
    expect(listBudgetIncidents({ openOnly: true }).some((i) => i.id === id)).toBe(true)
  })

  it('listUnnotifiedIncidents returns live (open + acknowledged) rows with nothing delivered, never resolved ones', () => {
    const a = openBudgetIncident(capInput('unnotified-a')).id
    const b = openBudgetIncident(capInput('unnotified-b')).id
    const c = openBudgetIncident(capInput('unnotified-c')).id
    resolveBudgetIncident({ id: b, status: 'acknowledged', resolution: 'acknowledged' })
    resolveBudgetIncident({ id: c, status: 'resolved', resolution: 'raised' })
    const ids = listUnnotifiedIncidents().map((i) => i.id)
    expect(ids).toContain(a)
    expect(ids).toContain(b)
    expect(ids).not.toContain(c)
  })
})

describe('budget_milestones (D19, D22)', () => {
  const RULE = randomUUID()
  const crossing = (milestone: 50 | 75 | 90 | 100, extra: Record<string, unknown> = {}) => ({
    ruleId: RULE, window: 'monthly' as const, windowStartMs: W0, milestone,
    spentValue: 5_100_000, capValue: 10_000_000, unit: 'usd_micros' as const, crossedAt: W0 + 5,
    ...extra,
  })

  it('records missing rows once per (rule, window, window start, milestone) and returns only the NEW ones', () => {
    const first = recordMilestoneCrossings([crossing(50), crossing(75)])
    expect(first.map((r) => r.milestone)).toEqual([50, 75])
    expect(first[0].eventId).toMatch(UUID_RE)
    expect(first[0].notifiedAt).toBeNull()
    expect(first[0].coveredBy).toBeNull()
    // Same crossings again (a later pass) ⇒ nothing new.
    expect(recordMilestoneCrossings([crossing(50), crossing(75)])).toEqual([])
    // A higher crossing in one pass covers the lower new ones at record time.
    const jump = recordMilestoneCrossings([crossing(90, { coveredBy: 100, notifiedAt: W0 + 9 }), crossing(100)])
    expect(jump.map((r) => [r.milestone, r.coveredBy, r.notifiedAt])).toEqual([[90, 100, W0 + 9], [100, null, null]])
    expect(listMilestones({ ruleId: RULE }).map((r) => r.milestone)).toEqual([50, 75, 90, 100])
  })

  it('a recreated rule (new id) gets fresh rows even for the same window', () => {
    const fresh = randomUUID()
    expect(recordMilestoneCrossings([crossing(50, { ruleId: fresh })]).map((r) => r.ruleId)).toEqual([fresh])
    expect(listMilestones({ ruleId: fresh })).toHaveLength(1)
  })

  it('unnotified milestones are the < 100 rows with no delivery; marks name the event; ack is per window', () => {
    const rule = randomUUID()
    const rows = recordMilestoneCrossings([crossing(50, { ruleId: rule }), crossing(100, { ruleId: rule })])
    const fifty = rows.find((r) => r.milestone === 50)!
    const pending = listUnnotifiedMilestones().filter((r) => r.ruleId === rule)
    // The 100 row's alert IS the cap incident — never delivered as a milestone.
    expect(pending.map((r) => r.milestone)).toEqual([50])
    expect(markMilestoneNotified(fifty.id, 'not-its-event')).toBe(0)
    expect(markMilestoneNotified(fifty.id, fifty.eventId)).toBe(1)
    expect(listUnnotifiedMilestones().some((r) => r.id === fifty.id)).toBe(false)
    expect(acknowledgeMilestone(fifty.id, W0 + 99)).toBe(true)
    expect(listMilestones({ ruleId: rule }).find((r) => r.id === fifty.id)!.acknowledgedAt).toBe(W0 + 99)
  })
})
