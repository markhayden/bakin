/**
 * acks — names acknowledge/snooze records that fail the ack verb's
 * own write rules (#898). `~/.bakin/health/acks.json` is a plain file
 * anything running as this user can write; the projection already ignores
 * a record that breaks the rules (the incident shows), and this check is
 * where the bad record becomes visible instead of quietly doing nothing.
 */
import { healthHealthy, healthObserved, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthResource } from '@makinbakin/sdk'
import { HealthAckStoreError, inspectAckStore } from '../../../../src/core/health-acks'

const RESOURCE: HealthResource = { kind: 'system', id: 'health-acks', label: '~/.bakin/health/acks.json' }

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
        disposition: 'watch',
        class: 'evidence_gap',
        resources: [RESOURCE],
        resolution: {
          key: 'fix-acks-file',
          type: 'instructions',
          label: 'Fix acks.json',
          steps: ['Repair or delete ~/.bakin/health/acks.json, then rerun Health. Deleting it un-acknowledges every incident.'],
        },
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
      title: 'Ignored acknowledgement records',
      impact: 'These records were not written by Acknowledge or Snooze, so the incidents they name are showing. Something edited the acknowledgement file by hand.',
      disposition: 'watch',
      class: 'evidence_gap',
      resources: [RESOURCE],
      resolution: {
        key: 'clear-invalid-acks',
        type: 'instructions',
        label: 'Clear the records',
        steps: [
          'Acknowledge or snooze from Health if the incident should be quiet; clear each ignored record first:',
          ...store.invalid.map((entry) => `bakin doctor unack ${entry.key}`),
        ],
      },
    },
  })])
}
