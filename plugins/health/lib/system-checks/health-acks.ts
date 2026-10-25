/**
 * acks — names acknowledge/snooze records that fail the ack verb's
 * own write rules (#898). `~/.bakin/health/acks.json` is a plain file
 * anything running as this user can write; the projection already ignores
 * a record that breaks the rules (the incident shows), and this check is
 * where the bad record becomes visible instead of quietly doing nothing.
 *
 * Two self-heal repairs (self-healing PR1 slice 1.3c, re-homing rows 1–2):
 * `health-acks-reset` moves an unreadable file aside (never deletes it) so
 * the store starts empty, and `health-acks-prune` removes exactly the
 * records that break the rules and keeps every valid one.
 */
import { renameSync } from 'fs'
import { healthHealthy, healthObserved, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthIncidentDeclaration, HealthRepairActionDefinition, HealthResource, HealthSubject } from '@makinbakin/sdk'
import { repairTargetSelection } from '@bakin/core/health/repair-support'
import { HealthAckStoreError, acksPath, inspectAckStore, removeAckRecord } from '../../../../src/core/health-acks'

const RESOURCE: HealthResource = { kind: 'system', id: 'health-acks', label: '~/.bakin/health/acks.json' }
const SUBJECT: HealthSubject = { kind: 'record', id: 'health/acks.json', label: '~/.bakin/health/acks.json' }
const CHECK_ID = 'health.acks'
export const HEALTH_ACKS_RESET_ACTION = 'health-acks-reset'
export const HEALTH_ACKS_PRUNE_ACTION = 'health-acks-prune'
/** Rows 1–2: both self-heal; neither is a required capability. */
export const HEALTH_ACKS_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'store-unreadable', subjectKind: 'record', resolution: { type: 'repair', actionId: HEALTH_ACKS_RESET_ACTION }, required: 'never' },
  { id: 'invalid-records', subjectKind: 'record', resolution: { type: 'repair', actionId: HEALTH_ACKS_PRUNE_ACTION }, required: 'never' },
]
const NO_EFFECTS = { deletesUserContent: false, spendsMoney: false, widensAuthorization: false }

export async function checkHealthAcks(nowMs = Date.now()): Promise<HealthCheckRunInput> {
  let store: ReturnType<typeof inspectAckStore>
  try {
    store = inspectAckStore(nowMs)
  } catch (err) {
    if (!(err instanceof HealthAckStoreError)) throw err
    return healthObserved([healthWarning({
      key: 'store',
      summary: 'The acknowledgement file is unreadable — every incident is showing.',
      detail: err.message,
      incident: {
        key: 'store-unreadable',
        title: 'Health acknowledgements are unreadable',
        impact: 'Acknowledged and snoozed incidents are all showing again until the file is valid JSON.',
        disposition: 'advisory',
        class: 'evidence_gap',
        subject: SUBJECT,
        declarationId: 'store-unreadable',
        resources: [RESOURCE],
        resolution: { key: HEALTH_ACKS_RESET_ACTION, type: 'repair', label: 'Move the file aside and start fresh', actionId: HEALTH_ACKS_RESET_ACTION },
      },
    })])
  }

  const valid = Object.keys(store.records).length
  if (store.invalid.length === 0) {
    return healthObserved([healthHealthy({
      key: 'store',
      summary: valid === 0 ? 'No acknowledged or snoozed incidents.' : `${valid} acknowledgement${valid === 1 ? '' : 's'}, all valid.`,
    })])
  }
  return healthObserved([healthWarning({
    key: 'store',
    summary: `${store.invalid.length} acknowledgement record${store.invalid.length === 1 ? '' : 's'} broke the acknowledge rules and ${store.invalid.length === 1 ? 'is' : 'are'} ignored.`,
    detail: store.invalid.map((entry) => `${entry.key}: ${entry.reason}`).join('\n'),
    evidence: { invalid: store.invalid.map(({ key, reason }) => ({ key, reason })) },
    incident: {
      key: 'invalid-records',
      declarationId: 'invalid-records',
      subject: SUBJECT,
      title: 'Ignored acknowledgement records',
      impact: 'These records break the acknowledge rules (for example a permanent acknowledgement of an action-required incident, a snooze longer than 7 days, or a date in the future), so they quiet nothing and the incidents they name are showing.',
      disposition: 'advisory',
      class: 'evidence_gap',
      resources: [RESOURCE],
      resolution: { key: HEALTH_ACKS_PRUNE_ACTION, type: 'repair', label: 'Remove the ignored records', actionId: HEALTH_ACKS_PRUNE_ACTION },
    },
  })])
}

/** Whether the store currently fails to read (the reset's only trigger). */
function storeUnreadable(): string | null {
  try {
    inspectAckStore()
    return null
  } catch (err) {
    if (err instanceof HealthAckStoreError) return err.message
    throw err
  }
}

export function healthAcksResetRepair(): HealthRepairActionDefinition {
  return {
    id: HEALTH_ACKS_RESET_ACTION,
    name: 'Move the unreadable acknowledgement file aside',
    effects: NO_EFFECTS,
    mutation: 'none', // moves Bakin's own ack file aside / drops its own broken records — nothing the user owns
    operationPlan: () => ({ stages: [{ id: 'reset', kind: 'installing', label: 'Move the file aside' }], pointOfNoReturn: 'reset' }),
    async plan(target) {
      const problem = storeUnreadable()
      if (!problem) return []
      return [{
        id: HEALTH_ACKS_RESET_ACTION,
        actionId: HEALTH_ACKS_RESET_ACTION,
        title: 'Move the unreadable acknowledgement file aside',
        reason: problem,
        ...repairTargetSelection(target),
        changes: [{ kind: 'file', target: 'health/acks.json', action: 'update', description: 'Rename the file to a dated .rejected copy (nothing is deleted) and start with no acknowledgements.' }],
      }]
    },
    async apply(items, op) {
      if (items.length === 0) return []
      op.stage('reset')
      const path = acksPath()
      const aside = `${path}.rejected-${new Date().toISOString().replace(/[:.]/g, '-')}`
      try {
        renameSync(path, aside)
        op.item('reset', { id: 'acks', label: 'acks.json', status: 'done', message: `moved to ${aside}` })
        return items.map((item) => ({ itemId: item.id, actionId: item.actionId, status: 'applied' as const, message: `The unreadable file was moved to ${aside}; every incident shows until you acknowledge it again.`, affectedCheckIds: [CHECK_ID], changes: item.changes }))
      } catch (err) {
        const message = `Could not move the acknowledgement file aside: ${err instanceof Error ? err.message : String(err)}`
        op.item('reset', { id: 'acks', label: 'acks.json', status: 'failed', message })
        return items.map((item) => ({ itemId: item.id, actionId: item.actionId, status: 'failed' as const, message, affectedCheckIds: [CHECK_ID], changes: item.changes }))
      }
    },
  }
}

export function healthAcksPruneRepair(): HealthRepairActionDefinition {
  return {
    id: HEALTH_ACKS_PRUNE_ACTION,
    name: 'Remove acknowledgement records that break the rules',
    effects: NO_EFFECTS,
    mutation: 'none', // moves Bakin's own ack file aside / drops its own broken records — nothing the user owns
    operationPlan: () => ({ stages: [{ id: 'prune', kind: 'installing', label: 'Remove the records' }], pointOfNoReturn: 'prune' }),
    async plan(target) {
      if (storeUnreadable()) return []
      const { invalid } = inspectAckStore()
      if (invalid.length === 0) return []
      return [{
        id: HEALTH_ACKS_PRUNE_ACTION,
        actionId: HEALTH_ACKS_PRUNE_ACTION,
        title: `Remove ${invalid.length} ignored acknowledgement record${invalid.length === 1 ? '' : 's'}`,
        reason: 'These records quiet nothing; removing them makes the file match what Health applies.',
        ...repairTargetSelection(target),
        changes: invalid.map((entry) => ({ kind: 'file' as const, target: `acks:${entry.key}`, action: 'delete' as const, description: `${entry.key}: ${entry.reason}.` })),
      }]
    },
    async apply(items, op) {
      if (items.length === 0) return []
      op.stage('prune')
      const keys = items.flatMap((item) => item.changes.map((change) => change.target)).filter((t) => t.startsWith('acks:')).map((t) => t.slice('acks:'.length))
      let removed = 0
      const problems: string[] = []
      for (const key of keys) {
        try {
          if (removeAckRecord(key)) removed++
          op.item('prune', { id: key, label: key, status: 'done' })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          problems.push(`${key}: ${message}`)
          op.item('prune', { id: key, label: key, status: 'failed', message })
        }
      }
      const message = problems.length > 0 ? `Removed ${removed}; ${problems.join('; ')}` : `Removed ${removed} record${removed === 1 ? '' : 's'}.`
      return items.map((item) => ({ itemId: item.id, actionId: item.actionId, status: problems.length > 0 ? 'failed' as const : 'applied' as const, message, affectedCheckIds: [CHECK_ID], changes: item.changes }))
    },
  }
}
