/**
 * System check — runtime channel approval response capability.
 *
 * Gate approval records are durable in Bakin. Runtime channels may render the
 * request, but only channels that advertise `interactive-approval` can feed
 * approve/reject decisions back into Bakin.
 *
 * Readiness-aware (#908 §4.7): reads the ONE readiness snapshot instead of
 * `runtime.channels.list()`; while delivery is unavailable it is
 * not-applicable and defers to the Discord delivery bridge check.
 */
import { hasChannelCapability } from '@bakin/core/adapters/runtime'
import { DELIVERABLE_STATES } from '@bakin/core/delivery'
import { healthHealthy, healthNotApplicable, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput } from '@makinbakin/sdk'
import { getChannelReadiness } from '../../../../src/core/delivery/readiness'
import { stableKeyPart } from './key'

export async function checkChannelApprovals(): Promise<HealthCheckRunInput> {
  const readiness = getChannelReadiness()
  if (readiness.owner === 'none') {
    return healthNotApplicable('The active runtime has no channel layer; workflow gates remain available in the Bakin UI.')
  }
  if (readiness.owner === 'bridge' && !DELIVERABLE_STATES.includes(readiness.connection.state)) {
    return healthNotApplicable(
      `Channel delivery is unavailable (${readiness.connection.state}) — see the Discord delivery bridge check. Workflow gates remain available in the Bakin UI.`,
    )
  }
  if (readiness.channels.collectedAt === null) {
    return healthObserved([healthUnknown({
      key: 'interactive-support',
      summary: 'Channel approval support could not be verified.',
      detail: readiness.channels.error?.message ?? 'The channel list has not been collected yet.',
      incident: {
        key: 'inspection-failed',
        title: 'Channel approval support is unknown',
        class: 'evidence_gap',
        impact: 'Health cannot confirm whether approvals can be completed from runtime channels.',
        disposition: 'watch',
        resources: [{ kind: 'runtime', id: 'active', label: 'Active runtime' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
    })])
  }

  const channels = readiness.channels.items
  const interactive = channels.filter((channel) => hasChannelCapability(channel.capabilities, 'interactive-approval'))
  if (interactive.length > 0) {
    return healthObserved([healthHealthy({
      key: 'interactive-support',
      summary: 'Interactive channel approvals are available.',
      detail: `Available on ${interactive.slice(0, 20).map((channel) => channel.label || channel.id).join(', ')}`.slice(0, 3_999) + '.',
      evidence: { channelIds: interactive.slice(0, 50).map((channel) => channel.id.slice(0, 500)) },
    })])
  }

  return healthObserved([healthWarning({
    key: 'interactive-support',
    summary: 'Runtime channel approvals are render-only.',
    detail: 'Approve or reject workflow gates in the Bakin UI until a runtime channel supports interactive approvals.',
    evidence: { channelIds: channels.slice(0, 50).map((channel) => channel.id.slice(0, 500)) },
    incident: {
      key: 'render-only',
      title: 'Channel approvals require the Bakin UI',
      class: 'unsupported_surface',
      impact: 'Operators cannot approve or reject workflow gates directly from runtime channels.',
      disposition: 'advisory',
      resources: channels.slice(0, 50).map((channel) => ({
        kind: 'channel' as const,
        id: stableKeyPart(channel.id),
        label: (channel.label || channel.id).slice(0, 120),
      })),
      resolution: {
        key: 'open-gates',
        type: 'navigate',
        label: 'Review workflow gates',
        href: '/tasks',
      },
    },
  })])
}
