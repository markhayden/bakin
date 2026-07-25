/**
 * System check — backfill-spin watchdog (spec search-trust-and-speed SD4).
 *
 * The antfly#319 family: an index leg that claims to be building while
 * making ZERO progress with nothing queued. On rc.17 this burned 300% CPU
 * for weeks with nobody told. Detection is two samples one window apart:
 * a leg that is `building`, has an empty journal for its table, and whose
 * indexedCount did not move is SPINNING → error finding + one-click
 * blue/green rebuild of that table (never automatic — SD4).
 *
 * No timers of its own: state is a module-level sample the doctor's own
 * cadence advances. Detection logic is pure (`detectSpins`) — the check
 * is a thin adapter over the health snapshot.
 */
import { healthError, healthHealthy, healthNotApplicable, healthObserved, healthUnknown } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthObservationInput, HealthRepairActionDefinition } from '@makinbakin/sdk'
import { stableKeyPart } from './key'
import { repairTargetSelection } from './repair-support'

/** Zero progress across this window while "building" = spinning. */
const SPIN_WINDOW_MS = 10 * 60 * 1000

export interface SpinLegSnapshot {
  /** Logical table (bakin_*). */
  logical: string
  leg: string
  building: boolean
  indexedCount: number
  /** Pending journal rows for this logical table (inflow that explains work). */
  outboxPending: number
}

export interface SpinSampleState {
  at: number
  /** `${logical}.${leg}` → indexedCount at sample time. */
  counts: Record<string, number>
}

const key = (leg: SpinLegSnapshot) => `${leg.logical}:${leg.leg}`

/**
 * Pure spin detection. Candidates are building legs with an idle journal;
 * a candidate whose count is unchanged since a sample ≥ window old is
 * spinning. The sample rolls forward only when the window has elapsed, so
 * slow progress is always measured against a full window.
 */
export function detectSpins(
  prev: SpinSampleState | null,
  now: number,
  legs: SpinLegSnapshot[],
  windowMs: number = SPIN_WINDOW_MS,
): { spins: SpinLegSnapshot[]; nextState: SpinSampleState } {
  const candidates = legs.filter((leg) => leg.building && leg.outboxPending === 0)
  const snapshot: SpinSampleState = {
    at: now,
    counts: Object.fromEntries(candidates.map((leg) => [key(leg), leg.indexedCount])),
  }
  if (!prev) return { spins: [], nextState: snapshot }
  if (now - prev.at < windowMs) {
    // window still open — keep the old sample, drop keys that stopped building
    const counts: Record<string, number> = {}
    for (const leg of candidates) {
      const k = key(leg)
      if (k in prev.counts) counts[k] = prev.counts[k]!
      else counts[k] = leg.indexedCount // new candidate joins the current window
    }
    return { spins: [], nextState: { at: prev.at, counts } }
  }
  const spins = candidates.filter((leg) => prev.counts[key(leg)] === leg.indexedCount)
  return { spins, nextState: snapshot }
}

// Doctor-cadence sample (module-level, like search-consistency's throttle).
let sample: SpinSampleState | null = null
// Tables named by the most recent spin finding — the repair's target list.
let lastSpinTables: string[] = []

/** Test-only. */
export function resetSpinStateForTests(): void {
  sample = null
  lastSpinTables = []
}

export async function checkSearchSpin(): Promise<HealthCheckRunInput> {
  const { getSettings } = await import('../../../../src/core/settings')
  if (!getSettings().search.settings.enabled) {
    return healthNotApplicable('Search is disabled; index-leg spin detection is not applicable.')
  }

  const { getAppServices } = await import('../../../../src/core/app-services')
  const search = getAppServices().search
  try {
    if (!await search.available()) {
      return healthNotApplicable('The Search engine is unavailable; the main Search check owns engine availability.')
    }
  } catch (err) {
    return healthObserved([spinUnknown(err)])
  }

  const { listTableStates } = await import('@bakin/core/search/tables')
  const { pendingCountForTable } = await import('@bakin/core/search/outbox')

  const legs: SpinLegSnapshot[] = []
  const inspectionErrors: string[] = []
  for (const table of listTableStates()) {
    const physicals = table.migratingTo ? [table.physical, table.migratingTo] : [table.physical]
    const pending = pendingCountForTable(table.logical)
    for (const physical of physicals) {
      const health = await search.tables.health?.(physical).catch((err) => {
        inspectionErrors.push(err instanceof Error ? err.message : String(err))
        return null
      })
      for (const leg of health ?? []) {
        legs.push({
          logical: table.logical,
          leg: `${physical === table.physical ? '' : 'green:'}${leg.leg}`,
          building: leg.state === 'building',
          indexedCount: leg.indexedCount,
          outboxPending: pending,
        })
      }
    }
  }

  const { spins, nextState } = detectSpins(sample, Date.now(), legs)
  sample = nextState

  if (spins.length === 0) {
    lastSpinTables = []
    if (inspectionErrors.length > 0) {
      return healthObserved([spinUnknown(inspectionErrors.join('; '))])
    }
    return healthObserved([healthHealthy({
      key: 'indexes.spin',
      summary: 'No Search index leg is spinning.',
      detail: 'Every measured leg is either making progress or idle.',
      evidence: { measuredLegs: legs.length },
    })])
  }
  const tables = Array.from(new Set(spins.map((s) => s.logical)))
  lastSpinTables = tables
  const observations: HealthObservationInput[] = [healthError({
    key: 'indexes.spin',
    summary: `Backfill spin detected in ${tables.length} Search table${tables.length === 1 ? '' : 's'}.`,
    detail: `${spins.map((spin) => `${spin.logical} (${spin.leg})`).join(', ')} reported no progress with an empty journal for at least 10 minutes.`,
    evidence: {
      tables,
      legs: spins.map(({ logical, leg, indexedCount, outboxPending }) => ({ logical, leg, indexedCount, outboxPending })),
      windowMs: SPIN_WINDOW_MS,
    },
    incident: {
      key: 'backfill-spin',
      title: 'Search index backfill is spinning',
      class: 'service_failure',
      impact: 'The engine can consume sustained CPU without advancing the affected indexes.',
      disposition: 'action_required',
      resources: tables.slice(0, 50).map((table) => ({ kind: 'search_table' as const, id: stableKeyPart(table), label: table.slice(0, 120) })),
      resolution: {
        key: 'rebuild-spinning-tables',
        type: 'repair',
        label: 'Rebuild affected indexes blue/green',
        actionId: 'search-spin-rebuild',
      },
    },
  })]
  if (inspectionErrors.length > 0) observations.push(spinUnknown(inspectionErrors.join('; ')))
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}

export function searchSpinRepair(): HealthRepairActionDefinition {
  return {
    id: 'search-spin-rebuild',
    name: 'Rebuild spinning Search indexes',
    async plan(target) {
      return [{
        id: 'rebuild-spinning-indexes',
        actionId: 'search-spin-rebuild',
        title: 'Rebuild spinning search tables (blue/green)',
        reason: 'One or more building index legs made no progress for a full watchdog window with no queued writes.',
        safety: 'destructive',
        ...repairTargetSelection(target),
        changes: [{
          kind: 'other',
          target: 'search tables',
          action: 'update',
          description: 'Backfill fresh physical tables from source data and flip on convergence; queries keep answering from the current tables throughout.',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      const { rebuildRegisteredTables } = await import('../../../../src/core/search-registry')
      const targets = [...lastSpinTables]
      const outcomes: string[] = []
      let failed = 0
      try {
        for (const logical of targets) {
          const [result] = await rebuildRegisteredTables(logical)
          if (!result || result.error || result.result === 'parked') failed++
          outcomes.push(`${logical}: ${result?.error ?? result?.result ?? 'no registered definition'}`)
        }
        resetSpinStateForTests()
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: failed > 0 ? 'failed' as const : 'applied' as const,
          message: targets.length === 0 ? 'Nothing needs rebuilding.' : outcomes.join('; '),
          affectedCheckIds: ['health.search-spin'],
          changes: item.changes,
        }))
      } catch (err) {
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'failed' as const,
          message: err instanceof Error ? err.message : String(err),
          affectedCheckIds: ['health.search-spin'],
          changes: item.changes,
        }))
      }
    },
  }
}

function spinUnknown(error: unknown) {
  return healthUnknown({
    key: 'indexes.spin',
    summary: 'Search index-leg progress could not be verified.',
    detail: error instanceof Error ? error.message : String(error),
    incident: {
      key: 'spin-status-unknown',
      title: 'Search index spin status is unknown',
      impact: 'Health cannot confirm whether active index builds are making progress.',
      disposition: 'watch',
      resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
      resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
    },
  })
}
