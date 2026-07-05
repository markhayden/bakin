/**
 * System check — durable search-outbox health.
 *
 * The outbox is the write journal (spec D5): rows waiting = the engine is
 * (or was) unreachable; quarantined rows = writes the engine REJECTED five
 * times (schema/shape problems that retrying identical payloads cannot
 * fix). Repair revives quarantined rows for one more attempt — useful
 * after an engine upgrade or a doc-shape fix.
 */
import { healthOk, healthWarn } from '@makinbakin/sdk/utils'
import type { HealthCheckResult, HealthRepairHandler } from '../../../../packages/core/src/plugin-types'

/** Pending rows older than this suggest the engine has been down a while. */
const STALE_PENDING_MS = 10 * 60 * 1000

export async function checkSearchOutbox(): Promise<HealthCheckResult[]> {
  const { getSettings } = await import('../../../../src/core/settings')
  if (!getSettings().search.settings.enabled) return []

  const { outboxStats, listQuarantined } = await import('../../../../src/core/search-outbox')
  const stats = outboxStats()
  const results: HealthCheckResult[] = []

  if (stats.quarantined > 0) {
    const sample = listQuarantined(3)
      .map((row) => `${row.logicalTable}/${row.key}${row.lastError ? ` (${row.lastError.slice(0, 80)})` : ''}`)
      .join('; ')
    results.push({
      check: 'search-outbox',
      status: 'error',
      message: `${stats.quarantined} search write(s) quarantined after repeated rejection — e.g. ${sample}. Repair retries them once revived.`,
      autoFixable: true,
    })
  }

  const oldest = stats.oldestPendingEnqueuedAt
  if (stats.pending > 0 && oldest !== null && Date.now() - oldest > STALE_PENDING_MS) {
    const minutes = Math.round((Date.now() - oldest) / 60_000)
    results.push(healthWarn(
      'search-outbox',
      `${stats.pending} search write(s) queued for ${minutes}m — the engine looks unreachable; writes land automatically when it returns`,
    ))
  }

  if (results.length === 0) {
    results.push(healthOk(
      'search-outbox',
      stats.pending > 0
        ? `${stats.pending} write(s) in flight — draining normally`
        : 'Write journal empty — all search writes landed',
    ))
  }
  return results
}

export function searchOutboxRepair(): HealthRepairHandler {
  return {
    async plan(rows) {
      const matching = rows.filter((row) => row.check === 'search-outbox' && row.autoFixable)
      if (matching.length === 0) return []
      return [{
        id: 'health.repair-search-outbox',
        checkId: 'search-outbox',
        title: 'Retry quarantined search writes',
        reason: matching.map((row) => row.message).join('; '),
        safety: 'manual',
        requiresConfirmation: true,
        changes: [{
          kind: 'other',
          target: 'search outbox',
          action: 'update',
          description: 'Revive quarantined rows for another delivery attempt (no data is deleted).',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      const { retryQuarantined, nudgeOutboxPump } = await import('../../../../src/core/search-outbox')
      const revived = retryQuarantined()
      await nudgeOutboxPump()
      return [{
        id: 'health.repair-search-outbox',
        checkId: 'search-outbox',
        status: 'applied',
        message: `Revived ${revived} quarantined write(s); the pump is retrying them now`,
        changes: [],
      }]
    },
  }
}
