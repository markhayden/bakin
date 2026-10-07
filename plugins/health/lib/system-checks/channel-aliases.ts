/**
 * Channel alias validation — readiness-aware (#908 §4.7). Reads the ONE
 * readiness snapshot instead of calling `runtime.channels.list()`: while
 * delivery is unavailable this check is not-applicable and points at the
 * Discord delivery bridge check, so an outage yields ONE incident, never a
 * cascade of alias/approval ones.
 */
import { CHANNELS_SETTINGS_HREF, DELIVERABLE_STATES } from '@bakin/core/delivery'
import { healthHealthy, healthNotApplicable, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput } from '@makinbakin/sdk'
import { getSettings } from '../../../../src/core/settings'
import { readConfiguredChannelAliases, resolveChannelRef } from '../../../../src/core/channel-aliases'
import { getChannelReadiness } from '../../../../src/core/delivery/readiness'

function targetDriver(target: string): string {
  return target.split(':')[0]
}

export async function checkChannelAliases(): Promise<HealthCheckRunInput> {
  const readiness = getChannelReadiness()
  const aliasCount = Object.keys(readConfiguredChannelAliases()).length

  if (readiness.owner === 'none') {
    return healthNotApplicable(
      aliasCount === 0
        ? 'The active runtime has no channel layer — no channel aliases to validate.'
        : `The active runtime has no channel layer — ${aliasCount} configured channel alias${aliasCount === 1 ? '' : 'es'} inert until a channel-bearing runtime is active.`,
    )
  }
  if (readiness.owner === 'bridge' && !DELIVERABLE_STATES.includes(readiness.connection.state)) {
    return healthNotApplicable(
      `Channel delivery is unavailable (${readiness.connection.state}) — see the Discord delivery bridge check. Aliases are validated once delivery is up.`,
    )
  }
  if (readiness.channels.collectedAt === null) {
    return healthObserved([healthUnknown({
      key: 'validation',
      summary: 'Channel aliases could not be verified.',
      detail: readiness.channels.error?.message ?? 'The channel list has not been collected yet.',
      incident: {
        key: 'inspection-failed',
        title: 'Channel alias status is unknown',
        class: 'evidence_gap',
        impact: 'Health cannot confirm whether configured aliases resolve to available runtime channels.',
        disposition: 'watch',
        resources: [{ kind: 'runtime', id: 'active', label: 'Active runtime' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
    })])
  }

  // Runtimes list channels in two id shapes: provider-level ids (OpenClaw:
  // "discord") and fully-qualified per-channel refs (the delivery bridge,
  // #669: "discord:channel:<id>"). A target resolves when either the exact
  // ref or its provider prefix is known, so expand the known set with each
  // id's driver prefix.
  const knownChannelIds = Array.from(new Set(
    readiness.channels.items.flatMap((channel) => [channel.id, targetDriver(channel.id)]),
  ))
  const known = new Set(knownChannelIds)
  const aliases = readConfiguredChannelAliases()
  const settings = getSettings()
  const configuredAlertChannel = settings.notifications.channel.trim()
  const failures: string[] = []

  for (const alias of Object.keys(aliases)) {
    try {
      const resolved = resolveChannelRef(alias, { aliases, knownChannelIds })
      if (!known.has(targetDriver(resolved.resolved))) {
        failures.push(`${alias} -> ${resolved.resolved} targets an unavailable runtime channel`)
      }
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err))
    }
  }

  if (configuredAlertChannel && configuredAlertChannel !== 'none') {
    try {
      resolveChannelRef(configuredAlertChannel, { aliases, knownChannelIds })
    } catch (err) {
      failures.push(`Alert channel ${configuredAlertChannel}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (failures.length > 0) {
    return healthObserved([healthWarning({
      key: 'validation',
      summary: 'Some channel aliases do not resolve.',
      detail: failures.slice(0, 20).join('; ').slice(0, 4_000),
      evidence: { failures: failures.slice(0, 50).map((failure) => failure.slice(0, 500)) },
      incident: {
        key: 'invalid-aliases',
        title: 'Channel aliases need attention',
        impact: 'Alerts or workflow messages addressed through invalid aliases may not reach their destination.',
        disposition: 'action_required',
        resources: [{ kind: 'setting', id: 'channel-aliases', label: 'Channel aliases' }],
        resolution: {
          key: 'open-channels',
          type: 'navigate',
          label: 'Review channel routing',
          href: CHANNELS_SETTINGS_HREF,
        },
      },
    })])
  }
  if (aliasCount === 0) {
    return healthObserved([healthHealthy({
      key: 'validation',
      summary: 'No channel aliases are configured.',
      detail: `Runtime channels: ${knownChannelIds.join(', ') || 'none'}.`,
      evidence: { aliasCount: 0, knownChannelIds: knownChannelIds.slice(0, 50) },
    })])
  }
  return healthObserved([healthHealthy({
    key: 'validation',
    summary: `${aliasCount} channel alias${aliasCount === 1 ? ' is' : 'es are'} valid.`,
    detail: `Runtime channels: ${knownChannelIds.join(', ')}.`,
    evidence: { aliasCount, knownChannelIds: knownChannelIds.slice(0, 50) },
  })])
}
