import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { healthOk, healthWarn } from '@makinbakin/sdk/utils'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'
import { getSettings } from '../../../../src/core/settings'
import { readConfiguredChannelAliases, resolveChannelRef } from '../../../../src/core/channel-aliases'

function ok(message: string): HealthCheckResult {
  return healthOk('channel-aliases', message)
}

function warn(message: string): HealthCheckResult {
  return healthWarn('channel-aliases', message)
}

function targetDriver(target: string): string {
  return target.split(':')[0]
}

export async function checkChannelAliases(runtime: Pick<AgentRuntimeAdapter, 'channels'>): Promise<HealthCheckResult[]> {
  // Optional capability (P2.1): no channel layer → aliases have no runtime
  // targets to validate against. Configured aliases are surfaced as inert,
  // not broken (they become meaningful again on a channel-bearing runtime).
  if (!runtime.channels) {
    const aliasCount = Object.keys(readConfiguredChannelAliases()).length
    return [ok(
      aliasCount === 0
        ? 'The active runtime has no channel layer — no channel aliases to validate.'
        : `The active runtime has no channel layer — ${aliasCount} configured channel alias${aliasCount === 1 ? '' : 'es'} inert until a channel-bearing runtime is active.`,
    )]
  }
  let knownChannelIds: string[]
  try {
    knownChannelIds = (await runtime.channels.list()).map((channel) => channel.id)
  } catch (err) {
    return [warn(`Could not inspect runtime channels for alias validation: ${err instanceof Error ? err.message : String(err)}`)]
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

  if (failures.length > 0) return [warn(failures.join('; '))]
  const aliasCount = Object.keys(aliases).length
  if (aliasCount === 0) return [ok('No channel aliases configured')]
  return [ok(`${aliasCount} channel alias${aliasCount === 1 ? '' : 'es'} valid for runtime channels: ${knownChannelIds.join(', ') || 'none'}`)]
}
