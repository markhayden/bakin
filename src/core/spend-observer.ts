/**
 * Spend observer + delivery worker (spend plan D19/D22/D29/D32, spec S9).
 *
 * `observeSpend` is the ONE place the milestone ladder is recorded: after
 * every spend write (`recordSpend`), after every successful usage scan, on
 * the watchdog tick, after every policy write and at boot, it reads the
 * limits policy, computes the crossings with the gate's own arithmetic
 * (`milestoneCrossings` over `assembleBudgetSpend`), inserts the missing
 * `budget_milestones` rows (lower rows reached in the same pass are covered
 * by the highest new one and need no delivery) and opens/reopens the cap
 * incident at 100 — the incident IS the alert for that level. The policy is
 * re-read after the (async) spend read: crossings are committed only
 * against the policy they were computed for, so a rule deleted mid-pass
 * cannot come back as an orphan incident.
 *
 * `deliverPending` is the ONE delivery worker: it sends every undelivered
 * milestone row (< 100) and cap incident from durable state, then marks the
 * exact `(id, event_id)` it sent. Rollover cleanup runs FIRST, so a headless
 * boot never relays yesterday's already-released defer alert; milestone rows
 * whose rule is gone or whose window has ended are marked as history, never
 * sent. A cap incident is marked delivered only once the REQUIRED channel
 * (the main-agent relay) succeeded — a failed relay stays pending and is
 * retried on the next pass; the SSE re-broadcast that retry repeats is
 * de-duplicated by consumers on `eventId`. At-least-once by construction.
 *
 * Both entry points are single-flight with coalescing: a call during a
 * pass schedules exactly one follow-up pass. The observer's facet memo is
 * keyed on (local day start, rules revision, spend generation) — a
 * post-write pass never reuses pre-write totals.
 */
import { createLogger } from './logger'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { dayStartMs, milestoneCrossings, monthStartMs, type BudgetPolicy, type BudgetRule, type MilestoneCrossing } from './budget'
import {
  listMilestones,
  listUnnotifiedIncidents,
  listUnnotifiedMilestones,
  markIncidentNotified,
  markMilestoneNotified,
  openBudgetIncident,
  recordMilestoneCrossings,
  resolveExpiredBudgetIncidents,
  type BudgetMilestone,
  type BudgetMilestoneRow,
  type MilestoneCrossingInput,
} from './execution-ledger'
import { broadcast } from './sse'
import { appendAudit } from './audit'
import { getContentDir } from './content-dir'
import { notifyBudgetIncidentOpened } from './budget-notify'
import { getAppServices } from './app-services-store'
import { onSpendRecorded } from './spend-events'

const log = createLogger('spend-observer')

const POLICY_HOOK = 'spend.getBudgetPolicy'

interface ObserverState {
  unsubscribe: (() => void) | null
  generation: number
  lastKey: string | null
  observing: Promise<void> | null
  observeFollowUp: number | null
  delivering: Promise<void> | null
  deliverFollowUp: boolean
}

// globalThis-homed so Bun HMR / plugin hot reload cannot leak a second
// worker alongside the first (same discipline as the usage timer).
const g = globalThis as typeof globalThis & { __bakinSpendObserver?: ObserverState }
function state(): ObserverState {
  g.__bakinSpendObserver ??= { unsubscribe: null, generation: 0, lastKey: null, observing: null, observeFollowUp: null, delivering: null, deliverFollowUp: false }
  return g.__bakinSpendObserver
}

/** Tests only. */
export function _resetSpendObserver(): void {
  g.__bakinSpendObserver?.unsubscribe?.()
  g.__bakinSpendObserver = undefined
}

/**
 * Subscribe the observer to spend writes. Idempotent; called once at boot
 * (startup-recovery) — before that, writes still land in the ledger and the
 * boot pass observes them.
 */
export function startSpendObserver(): void {
  const s = state()
  if (s.unsubscribe) return
  s.unsubscribe = onSpendRecorded(() => {
    bumpSpendGeneration()
    void observeSpend().catch((err: unknown) => log.error('Spend observer pass after a spend write failed', err))
  })
}

/** Every spend write bumps this; the observer's memo is keyed on it. */
export function bumpSpendGeneration(): void {
  state().generation += 1
}

function rulesRevision(policy: BudgetPolicy): string {
  return JSON.stringify((policy.rules ?? []).map((r) => [r.id ?? '', r.scope, r.scopeId ?? '', r.lane, r.dailyCap ?? null, r.monthlyCap ?? null, r.atCap ?? 'defer']))
}

async function readPolicy(): Promise<BudgetPolicy | null> {
  const registry = getHookRegistry()
  if (!registry.has(POLICY_HOOK)) return null
  const policy = await registry.invoke<BudgetPolicy>(POLICY_HOOK, {})
  return policy ?? null
}

/**
 * Lazy window rollover: yesterday's / last month's defer incidents resolve
 * `window_rollover` before anything is recorded or delivered, so no pass
 * can alert on a hold that no longer blocks work. Never throws.
 */
function sweepRollover(now: number): void {
  try {
    resolveExpiredBudgetIncidents({ dailyWindowStartMs: dayStartMs(now), monthlyWindowStartMs: monthStartMs(now), now })
  } catch (err) {
    log.warn('spend observer: incident rollover sweep failed', { err: err instanceof Error ? err.message : String(err) })
  }
}

/**
 * One observer pass. Never throws — a failed pass leaves the memo unset so
 * the next request recomputes.
 */
async function observeOnce(now: number): Promise<void> {
  const s = state()
  sweepRollover(now)
  let policy: BudgetPolicy | null
  try {
    policy = await readPolicy()
  } catch (err) {
    log.warn('spend observer: limits policy unreadable this pass', { err: err instanceof Error ? err.message : String(err) })
    return
  }
  if (!policy || !(policy.rules ?? []).some((r) => r.id)) return

  const revision = rulesRevision(policy)
  const key = `${dayStartMs(now)}|${revision}|${s.generation}`
  if (key !== s.lastKey) {
    try {
      const { assembleBudgetSpend } = await import('./budget-spend')
      const facets = await assembleBudgetSpend(now)
      // The spend read is an await a policy write can land during: commit
      // crossings only against the policy they were computed for. A moved
      // policy means a follow-up pass (the write requested one) recomputes.
      const after = await readPolicy()
      if (!after || rulesRevision(after) !== revision) {
        log.info('spend observer: limits changed during the pass; recomputing', {})
        s.observeFollowUp = s.observeFollowUp ?? now
      } else {
        const crossings = milestoneCrossings(policy, facets)
        recordCrossings(crossings, now)
        s.lastKey = key
      }
    } catch (err) {
      log.error('spend observer pass failed', err)
      return
    }
  }
  await deliverPending()
}

function recordCrossings(crossings: MilestoneCrossing[], now: number): void {
  const inputs: MilestoneCrossingInput[] = []
  for (const crossing of crossings) {
    const existing = new Set(listMilestones({ ruleId: crossing.ruleId, windowStartMs: crossing.windowStartMs })
      .filter((row) => row.window === crossing.window)
      .map((row) => row.milestone))
    // At/over the cap the incident is opened OR reopened every pass: the
    // ledger's UNIQUE makes a live one a no-op, and a raise-resolved one that
    // breached again becomes a new episode even though its 100 row exists.
    if (crossing.reached.includes(100)) openCapIncident(crossing, now)
    const fresh = crossing.reached.filter((m) => !existing.has(m))
    if (fresh.length === 0) continue
    const highest = fresh[fresh.length - 1]!
    for (const milestone of fresh) {
      // Rows below the highest NEW one are spoken for by it; the 100 row is
      // spoken for by the cap incident. Neither needs its own delivery.
      const coveredBy: BudgetMilestone | undefined = milestone < highest ? highest : milestone === 100 ? 100 : undefined
      inputs.push({
        ruleId: crossing.ruleId,
        window: crossing.window,
        windowStartMs: crossing.windowStartMs,
        milestone,
        spentValue: crossing.spentValue,
        capValue: crossing.capValue,
        unit: crossing.unit,
        crossedAt: now,
        ...(coveredBy !== undefined ? { coveredBy, notifiedAt: now } : {}),
      })
    }
  }
  const recorded = recordMilestoneCrossings(inputs)
  if (recorded.length > 0) log.info('spend milestones recorded', { rows: recorded.map((r) => `${r.ruleId}:${r.window}:${r.milestone}`) })
}

function openCapIncident(crossing: MilestoneCrossing, now: number): void {
  const rule: BudgetRule = crossing.rule
  const opened = openBudgetIncident({
    scope: rule.scope,
    scopeId: rule.scopeId,
    lane: rule.lane,
    window: crossing.window,
    windowStartMs: crossing.windowStartMs,
    kind: 'cap',
    unit: crossing.unit,
    capValue: crossing.capValue,
    spentValue: crossing.spentValue,
    atCap: rule.atCap ?? 'defer',
    openedAt: now,
  })
  if (!opened.opened) return
  log.info('spend cap incident opened by the observer', { incidentId: opened.id, ruleId: crossing.ruleId, window: crossing.window })
  // The durable lifecycle audit is independent of which path saw the
  // threshold first (the gate audits the same event when IT opens one).
  auditIncidentOpened({ incidentId: opened.id, source: 'observer', scope: rule.scope, scopeId: rule.scopeId, lane: rule.lane, window: crossing.window, unit: crossing.unit, spentValue: crossing.spentValue, capValue: crossing.capValue, atCap: rule.atCap ?? 'defer' })
}

/** `budget.incident_opened` — one audit row per opened/reopened episode, whichever path opened it. */
export function auditIncidentOpened(data: { incidentId: number; source: 'observer' | 'gate'; scope: string; scopeId?: string; lane: string; window: string; unit: string; spentValue: number; capValue: number; atCap: string }): void {
  try {
    appendAudit(getContentDir(), 'budget.incident_opened', 'system', { ...data, ...(data.scopeId ? {} : { scopeId: undefined }) })
  } catch (err) {
    log.warn('could not audit the opened budget incident', { err: err instanceof Error ? err.message : String(err), incidentId: data.incidentId })
  }
}

/**
 * Observe spend now — coalesced. A call that arrives during a pass gets
 * the in-flight promise and schedules exactly one follow-up pass with the
 * latest `now`.
 */
export function observeSpend(now: number = Date.now()): Promise<void> {
  const s = state()
  if (s.observing) {
    s.observeFollowUp = now
    return s.observing
  }
  const run = (async () => {
    try {
      await observeOnce(now)
    } finally {
      const followUp = s.observeFollowUp
      s.observeFollowUp = null
      s.observing = null
      if (followUp !== null) await observeSpend(followUp)
    }
  })()
  s.observing = run
  return run
}

/**
 * Aggregated milestone payload — one SSE event per rule × window per pass:
 * the highest undelivered crossing plus how many milestones it speaks for
 * (itself + the rows recorded as covered by it, which never get their own
 * delivery).
 */
function milestoneEvent(rows: BudgetMilestoneRow[], rule: BudgetRule): Record<string, unknown> {
  const highest = rows.reduce((max, row) => (row.milestone > max.milestone ? row : max), rows[0]!)
  const covered = listMilestones({ ruleId: highest.ruleId, windowStartMs: highest.windowStartMs })
    .filter((row) => row.window === highest.window && row.coveredBy === highest.milestone && row.id !== highest.id)
  const spokenFor = [highest, ...covered, ...rows.filter((row) => row.id !== highest.id)]
  return {
    type: 'plugin-event',
    event: 'spend.milestone',
    eventId: highest.eventId,
    milestoneId: highest.id,
    milestoneIds: spokenFor.map((r) => r.id),
    ruleId: highest.ruleId,
    scope: rule.scope,
    ...(rule.scopeId ? { scopeId: rule.scopeId } : {}),
    lane: rule.lane,
    window: highest.window,
    unit: highest.unit,
    highest: highest.milestone,
    count: spokenFor.length,
    spentValue: highest.spentValue,
    capValue: highest.capValue,
    timestamp: new Date().toISOString(),
  }
}

async function deliverOnce(now: number = Date.now()): Promise<void> {
  sweepRollover(now)

  // Milestones need the policy for their labels AND to tell live rows from
  // history; an unreadable policy leaves them pending (incidents carry
  // their own scope and still go).
  let policy: BudgetPolicy | null = null
  let policyReadable = true
  try {
    policy = await readPolicy()
  } catch (err) {
    policyReadable = false
    log.warn('spend delivery: limits policy unreadable; milestone rows wait', { err: err instanceof Error ? err.message : String(err) })
  }

  if (policyReadable) {
    const rules = new Map<string, BudgetRule>()
    for (const rule of policy?.rules ?? []) if (rule.id) rules.set(rule.id, rule)
    const windowStarts = { daily: dayStartMs(now), monthly: monthStartMs(now) }
    // One aggregated event per rule × window × window start: a daily-75 and
    // a monthly-50 of the same rule are two different facts.
    const groups = new Map<string, BudgetMilestoneRow[]>()
    for (const row of listUnnotifiedMilestones()) {
      const rule = rules.get(row.ruleId)
      if (!rule || row.windowStartMs !== windowStarts[row.window]) {
        // A deleted rule's row, or a crossing from a window that has ended,
        // is history: recorded, never announced as if it were current.
        markMilestoneNotified(row.id, row.eventId)
        continue
      }
      const key = `${row.ruleId}|${row.window}|${row.windowStartMs}`
      const list = groups.get(key) ?? []
      list.push(row)
      groups.set(key, list)
    }
    for (const rows of groups.values()) {
      const rule = rules.get(rows[0]!.ruleId)!
      try {
        broadcast(milestoneEvent(rows, rule))
      } catch (err) {
        log.error('spend milestone delivery failed; rows stay pending', err, { ruleId: rows[0]!.ruleId })
        continue
      }
      for (const row of rows) markMilestoneNotified(row.id, row.eventId)
    }
  }

  // Cap incidents: the existing fan-out (SSE + main-agent relay), one per
  // undelivered episode, marked by the exact event it sent — and only once
  // the relay (the away-from-the-browser channel) actually went out.
  for (const incident of listUnnotifiedIncidents()) {
    try {
      const outcome = await notifyBudgetIncidentOpened({
        incidentId: incident.id,
        eventId: incident.eventId,
        episode: incident.episode,
        kind: 'cap',
        scope: incident.scope,
        ...(incident.scopeId ? { scopeId: incident.scopeId } : {}),
        lane: incident.lane,
        window: incident.window,
        unit: incident.unit,
        capValue: incident.capValue,
        spentValue: incident.spentValue,
        atCap: incident.atCap,
      }, () => getAppServices().runtime)
      if (!outcome.relayed) {
        log.warn('spend incident relay did not complete; row stays pending for the next pass', { incidentId: incident.id, episode: incident.episode })
        continue
      }
    } catch (err) {
      log.error('spend incident delivery failed; row stays pending', err, { incidentId: incident.id })
      continue
    }
    markIncidentNotified(incident.id, incident.eventId)
  }
}

/**
 * Deliver every undelivered milestone/incident — the single-flight worker
 * shared by the observer, boot and the watchdog. A call during a pass
 * schedules exactly one follow-up pass.
 */
export function deliverPending(): Promise<void> {
  const s = state()
  if (s.delivering) {
    s.deliverFollowUp = true
    return s.delivering
  }
  const run = (async () => {
    try {
      await deliverOnce()
    } catch (err) {
      log.error('spend delivery pass failed', err)
    } finally {
      const followUp = s.deliverFollowUp
      s.deliverFollowUp = false
      s.delivering = null
      if (followUp) await deliverPending()
    }
  })()
  s.delivering = run
  return run
}
