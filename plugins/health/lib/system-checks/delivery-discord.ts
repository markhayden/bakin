/**
 * delivery.discord doctor check (#669 A7, reshaped by #908 §4.7): a
 * PROJECTION of the ONE channel-readiness snapshot. Native runtime first
 * (D14) — a token-less bridge block on OpenClaw is idle configuration,
 * never an incident. Every non-ready state is one incident with a stable
 * key and a navigate resolution into Settings → Channels; the Channels tab
 * and this check can never disagree because they read the same snapshot.
 */
import { CHANNELS_SETTINGS_HREF, type ChannelReadiness } from '@bakin/core/delivery'
import { healthHealthy, healthNotApplicable, healthObserved, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput } from '@makinbakin/sdk'
import { readDiscordConfig } from '../../../../src/core/delivery/config'
import { getChannelReadiness } from '../../../../src/core/delivery/readiness'

const openChannels = { key: 'open-channels', type: 'navigate' as const, label: 'Open Settings → Channels', href: CHANNELS_SETTINGS_HREF }
const discordSetting = [{ kind: 'setting' as const, id: 'integrations.discord', label: 'Discord integration' }]

function incident(
  readiness: ChannelReadiness,
  key: string,
  title: string,
  impact: string,
  summary: string,
) {
  const remediation = readiness.remediation
  return healthWarning({
    key,
    summary,
    detail: remediation ? `${remediation.summary} ${remediation.nextStep}` : summary,
    evidence: {
      state: readiness.connection.state,
      since: readiness.connection.since,
      ...(readiness.connection.lastError
        ? { lastError: { kind: readiness.connection.lastError.kind, message: readiness.connection.lastError.message, at: readiness.connection.lastError.at } }
        : {}),
    },
    incident: {
      key,
      title,
      class: 'service_failure',
      impact,
      disposition: 'action_required',
      resources: discordSetting,
      resolution: openChannels,
    },
  })
}

export async function checkDeliveryDiscord(): Promise<HealthCheckRunInput> {
  const readiness = getChannelReadiness()
  const { settings } = readDiscordConfig()
  const state = readiness.connection.state

  switch (state) {
    case 'native':
      return healthObserved([healthHealthy({
        key: 'idle',
        summary: 'Discord bridge is idle — the active runtime delivers natively.',
        detail: 'By design (D11/D14): the runtime\'s own bot owns Discord; two consumers on one token would double-handle messages. The Bakin bridge block is idle configuration, whatever it holds.',
        evidence: { deliveryMode: readiness.runtime.deliveryMode },
      })])
    case 'disabled':
      return healthNotApplicable('The Discord delivery bridge is not enabled (integrations.discord.enabled).')
    case 'missing_token':
      return healthObserved([incident(readiness, 'missing-token', 'Discord bridge has no bot token',
        'Channel delivery, gate approval cards, and inbound Discord chat cannot start.',
        'Discord bridge is enabled but no bot token is stored.')])
    case 'missing_guild':
      return healthObserved([incident(readiness, 'missing-guild', 'Discord bridge has no guilds to serve',
        'The bridge has no channels to enumerate or deliver to.',
        'Discord bridge is enabled but no guild IDs are configured.')])
    case 'connecting':
      // Watch, not action: an attempt is in flight and the READY deadline
      // bounds it. The targeted rerun's debounce means a healthy connect
      // rarely records this at all.
      return healthObserved([healthWarning({
        key: 'connecting',
        summary: 'Discord bridge is connecting.',
        detail: 'An attempt is in flight; the READY deadline bounds it. No action yet.',
        evidence: {
          since: readiness.connection.since,
          attempt: readiness.connection.attempt ? { generation: readiness.connection.attempt.generation, startedAt: readiness.connection.attempt.startedAt } : null,
        },
        incident: {
          key: 'connecting',
          title: 'Discord delivery bridge is connecting',
          class: 'service_failure',
          impact: 'Channel delivery resumes once the gateway reports READY.',
          disposition: 'watch',
          resources: discordSetting,
          resolution: { key: 'rerun', type: 'rerun', label: 'Check again' },
        },
      })])
    case 'failed':
      return healthObserved([incident(readiness, 'bridge-failed', 'Discord delivery bridge failed to connect',
        'Channel alerts, gate approval cards, and inbound Discord chat are not being delivered.',
        `Discord bridge failed to connect${readiness.connection.lastError ? ` (${readiness.connection.lastError.kind}: ${readiness.connection.lastError.message})` : ''}.`)])
    case 'disconnected':
      return healthObserved([incident(readiness, 'bridge-disconnected', 'Discord delivery bridge is disconnected',
        'Channel alerts, gate approval cards, and inbound Discord chat are not being delivered until the gateway resumes.',
        'Discord bridge lost its gateway connection.')])
    case 'degraded': {
      const missing = readiness.guilds.filter((guild) => guild.joined !== true || guild.channelCount === null || guild.error)
      return healthObserved([incident(readiness, 'guild-unjoined', 'Discord bridge cannot reach every configured server',
        'Posts to channels in an unreachable server fail; the other servers still deliver.',
        `Discord bridge is connected but ${missing.length} configured server${missing.length === 1 ? ' is' : 's are'} not reachable: ${missing.map((guild) => guild.id).join(', ')}.`)])
    }
    case 'connected':
      break
  }

  const notices = []
  if (settings.approvers.length === 0) {
    notices.push(healthWarning({
      key: 'approvers',
      summary: 'No Discord approvers are configured — approval buttons deny everyone (fail closed).',
      detail: 'Set the approvers list to the Discord user IDs allowed to decide gates.',
      incident: {
        key: 'empty-approvers',
        title: 'Discord approval buttons are locked',
        class: 'policy_denial',
        impact: 'Gate cards render in Discord but every click is denied until an approver is allowlisted.',
        disposition: 'watch',
        resources: discordSetting,
        resolution: { key: 'open-channels', type: 'navigate', label: 'Open Settings → Channels', href: `${CHANNELS_SETTINGS_HREF}&field=integrations.discord.approvers` },
      },
    }))
  }
  if (settings.inbound.enabled && settings.inbound.allowFrom.length === 0) {
    notices.push(healthWarning({
      key: 'inbound-allowlist',
      summary: 'Discord inbound chat is on but the allowlist is empty — every sender is ignored (fail closed).',
      detail: 'Set the inbound allowlist to the Discord user IDs allowed to chat.',
      incident: {
        key: 'empty-inbound-allowlist',
        title: 'Discord inbound chat is locked',
        class: 'policy_denial',
        impact: 'Messages at the bot are silently denied (audited) until a sender is allowlisted.',
        disposition: 'watch',
        resources: discordSetting,
        resolution: { key: 'open-channels', type: 'navigate', label: 'Open Settings → Channels', href: `${CHANNELS_SETTINGS_HREF}&field=integrations.discord.inbound.allowFrom` },
      },
    }))
  }
  if (notices.length > 0) return healthObserved([notices[0], ...notices.slice(1)])

  const guilds = readiness.guilds.length
  return healthObserved([healthHealthy({
    key: 'connection',
    summary: `Discord bridge is connected (${guilds} guild${guilds === 1 ? '' : 's'}, ${settings.approvers.length} approver${settings.approvers.length === 1 ? '' : 's'}).`,
    evidence: {
      guilds,
      approvers: settings.approvers.length,
      inbound: settings.inbound.enabled,
      since: readiness.connection.since,
    },
  })])
}
