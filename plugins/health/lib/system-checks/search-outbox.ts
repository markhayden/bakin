/**
 * System check — durable search-outbox health.
 *
 * The outbox is the write journal (spec D5): rows waiting = the engine is
 * (or was) unreachable; quarantined rows = writes the engine REJECTED five
 * times (schema/shape problems that retrying identical payloads cannot
 * fix). Repair revives quarantined rows for one more attempt — useful
 * after an engine upgrade or a doc-shape fix.
 */
import { healthError, healthHealthy, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthObservationInput, HealthRepairActionDefinition } from '@makinbakin/sdk'
import { stableKeyPart } from './key'
import { repairTargetSelection } from '@bakin/core/health/repair-support'

/** Pending rows older than this suggest the engine has been down a while. */
const STALE_PENDING_MS = 10 * 60 * 1000

export async function checkSearchOutboxObservations({ accessRefused = false } = {}): Promise<HealthObservationInput[]> {
  const { outboxStats, listQuarantined } = await import('../../../../src/core/search-outbox')
  const stats = outboxStats()
  if (accessRefused) {
    return [healthHealthy({
      key: 'journal.status',
      summary: `${stats.pending} queued search writes retained locally; ${stats.quarantined} previously quarantined.`,
      detail: 'Restore Search access for this home before attempting delivery or retrying quarantined writes.',
      evidence: { pending: stats.pending, quarantined: stats.quarantined, oldestPendingEnqueuedAt: stats.oldestPendingEnqueuedAt },
    })]
  }
  const observations: HealthObservationInput[] = []

  if (stats.quarantined > 0) {
    const sampleTables = [...new Set(listQuarantined(3).map((row) => row.logicalTable))]
    observations.push(healthError({
      key: 'journal.quarantined',
      summary: `${stats.quarantined} search write${stats.quarantined === 1 ? ' is' : 's are'} quarantined.`,
      detail: sampleTables.length > 0 ? `Affected tables include ${sampleTables.join(', ')}.` : undefined,
      evidence: { quarantined: stats.quarantined, sampleTables },
      incident: {
        key: 'quarantined-writes',
        title: 'Search writes were repeatedly rejected',
        impact: 'Quarantined changes are not reflected in Search indexes.',
        disposition: 'action_required',
        subject: { kind: 'service', id: 'search-engine', label: 'Search engine' },
        declarationId: 'quarantined-writes',
        resources: sampleTables.slice(0, 50).map((table) => ({
          kind: 'search_table' as const,
          id: stableKeyPart(table),
          label: table.slice(0, 120),
        })),
        resolution: {
          key: 'revive-quarantined',
          type: 'repair',
          label: 'Retry quarantined writes',
          actionId: 'search-outbox-revive',
        },
      },
    }))
  }

  const oldest = stats.oldestPendingEnqueuedAt
  if (stats.pending > 0 && oldest !== null && Date.now() - oldest > STALE_PENDING_MS) {
    const minutes = Math.round((Date.now() - oldest) / 60_000)
    observations.push(healthWarning({
      key: 'journal.backlog',
      summary: `${stats.pending} search write${stats.pending === 1 ? ' has' : 's have'} been queued for ${minutes} minutes.`,
      detail: 'The engine may be unreachable; queued writes deliver automatically when it returns.',
      evidence: { pending: stats.pending, oldestPendingEnqueuedAt: oldest, ageMinutes: minutes },
      incident: {
        key: 'stale-backlog',
        title: 'Search write journal is not draining',
        impact: 'Recent source changes may not appear in Search until the engine and journal pump recover.',
        disposition: 'watch',
        // Row 68: a symptom of the engine's failure — folded under the engine
        // subject, resolved by its restart (the journal drains on recovery).
        subject: { kind: 'service', id: 'search-engine', label: 'Search engine' },
        declarationId: 'stale-backlog',
        dependsOn: { subject: { kind: 'service', id: 'search-engine', label: 'Search engine' }, resolvedBy: 'search-engine-restart' },
        resources: [{ kind: 'system', id: 'search-journal', label: 'Search write journal' }],
        resolution: { key: 'inspect-engine', type: 'repair', label: 'Restore the Search engine', actionId: 'search-engine-restart' },
      },
    }))
  }

  if (observations.length === 0) {
    observations.push(healthHealthy({
      key: 'journal.status',
      summary: stats.pending > 0
        ? `${stats.pending} search write${stats.pending === 1 ? ' is' : 's are'} draining normally.`
        : 'All search writes have landed.',
      evidence: { pending: stats.pending, quarantined: stats.quarantined },
    }))
  }
  return observations
}

export function searchOutboxRepair(): HealthRepairActionDefinition {
  return {
    id: 'search-outbox-revive',
    name: 'Retry quarantined Search writes',
    // Row 67: reviving rows deletes nothing and spends nothing — self-heal (was manual).
    effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: false },
    operationPlan: () => ({
      stages: [{ id: 'revive', kind: 'committing', label: 'Revive quarantined writes' }],
      pointOfNoReturn: 'revive',
    }),
    async plan(target) {
      return [{
        id: 'revive-quarantined-writes',
        actionId: 'search-outbox-revive',
        title: 'Retry quarantined search writes',
        reason: 'Previously rejected writes may succeed after an engine upgrade or source-shape correction.',
        ...repairTargetSelection(target),
        changes: [{
          kind: 'other',
          target: 'search outbox',
          action: 'update',
          description: 'Revive quarantined rows for another delivery attempt (no data is deleted).',
        }],
      }]
    },
    async apply(items, op) {
      if (items.length === 0) return []
      const { retryQuarantined, nudgeOutboxPump } = await import('../../../../src/core/search-outbox')
      try {
        op.stage('revive')
        const revived = retryQuarantined()
        op.log(`Revived ${revived} quarantined write(s)`)
        await nudgeOutboxPump()
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'applied' as const,
          message: `Revived ${revived} quarantined write${revived === 1 ? '' : 's'}; the journal pump is retrying now.`,
          affectedCheckIds: ['health.search'],
          changes: item.changes,
        }))
      } catch (err) {
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'failed' as const,
          message: err instanceof Error ? err.message : String(err),
          affectedCheckIds: ['health.search'],
          changes: item.changes,
        }))
      }
    },
  }
}
