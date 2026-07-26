import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { healthHealthy, healthNotApplicable, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput } from '@makinbakin/sdk'
import { getSettings } from '../../../../src/core/settings'
import { readConfiguredChannelAliases, resolveChannelRef } from '../../../../src/core/channel-aliases'

function targetDriver(target: string): string {
  return target.split(':')[0]
}

export async function checkChannelAliases(runtime: Pick<AgentRuntimeAdapter, 'channels'>): Promise<HealthCheckRunInput> {
  // Optional capability (P2.1): no channel layer → aliases have no runtime
  // targets to validate against. Configured aliases are surfaced as inert,
  // not broken (they become meaningful again on a channel-bearing runtime).
  if (!runtime.channels) {
    const aliasCount = Object.keys(readConfiguredChannelAliases()).length
    return healthNotApplicable(
      aliasCount === 0
        ? 'The active runtime has no channel layer — no channel aliases to validate.'
        : `The active runtime has no channel layer — ${aliasCount} configured channel alias${aliasCount === 1 ? '' : 'es'} inert until a channel-bearing runtime is active.`,
    )
  }
  let knownChannelIds: string[]
  try {
    // Runtimes list channels in two id shapes: provider-level ids
    // (OpenClaw: "discord") and fully-qualified per-channel refs (the
    // delivery bridge, #669: "discord:channel:<id>"). A target resolves when
    // either the exact ref or its provider prefix is known, so expand the
    // known set with each id's driver prefix.
    knownChannelIds = Array.from(new Set(
      (await runtime.channels.list()).flatMap((channel) => [channel.id, targetDriver(channel.id)]),
    ))
  } catch (err) {
    return healthObserved([healthUnknown({
      key: 'validation',
      summary: 'Channel aliases could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
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
          key: 'open-settings',
          type: 'navigate',
          label: 'Review channel aliases',
          href: '/settings',
        },
      },
    })])
  }
  const aliasCount = Object.keys(aliases).length
  if (aliasCount === 0) {
    return healthObserved([healthHealthy({
      key: 'validation',
      summary: 'No channel aliases are configured.',
      evidence: { aliasCount: 0 },
    })])
  }
  return healthObserved([healthHealthy({
    key: 'validation',
    summary: `${aliasCount} channel alias${aliasCount === 1 ? ' is' : 'es are'} valid.`,
    detail: `Runtime channels: ${knownChannelIds.slice(0, 50).join(', ') || 'none'}.`.slice(0, 4_000),
    evidence: { aliasCount, knownChannelIds: knownChannelIds.slice(0, 50).map((id) => id.slice(0, 500)) },
  })])
}
