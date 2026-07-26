/**
 * delivery.discord doctor check (#669 A7): honest state of the Discord
 * delivery bridge. Owner-registered by the health plugin; every finding
 * carries a class + remediation. Missing evidence is Unknown, never healthy.
 */
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { healthHealthy, healthNotApplicable, healthObserved, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput } from '@makinbakin/sdk'
import { readDiscordConfig } from '../../../../src/core/delivery/config'
import { isDeliveryBridgeConnected } from '../../../../src/core/delivery'

export async function checkDeliveryDiscord(runtime: Pick<AgentRuntimeAdapter, 'capabilities'>): Promise<HealthCheckRunInput> {
  const { settings, token } = readDiscordConfig()

  if (!settings.enabled) {
    return healthNotApplicable('The Discord delivery bridge is not enabled (integrations.discord.enabled).')
  }

  if (!token) {
    return healthObserved([healthWarning({
      key: 'token',
      summary: 'Discord bridge is enabled but no bot token is stored.',
      detail: 'Add the bot token as integration "discord", secret "botToken" under Settings → Integrations & Keys (one-time copy from your existing bot).',
      incident: {
        key: 'missing-token',
        title: 'Discord bridge has no bot token',
        class: 'service_failure',
        impact: 'Channel delivery, gate approval cards, and inbound Discord chat cannot start.',
        disposition: 'action_required',
        resources: [{ kind: 'setting', id: 'integrations.discord', label: 'Discord integration' }],
        resolution: { key: 'open-keys', type: 'navigate', label: 'Open Integrations & Keys', href: '/settings' },
      },
    })])
  }

  if (settings.guildIds.length === 0) {
    return healthObserved([healthWarning({
      key: 'guilds',
      summary: 'Discord bridge is enabled but no guild IDs are configured.',
      detail: 'Set integrations.discord.guildIds (comma-separated) in Settings → System & Alerts.',
      incident: {
        key: 'missing-guilds',
        title: 'Discord bridge has no guilds to serve',
        class: 'service_failure',
        impact: 'The bridge has no channels to enumerate or deliver to.',
        disposition: 'action_required',
        resources: [{ kind: 'setting', id: 'integrations.discord', label: 'Discord integration' }],
        resolution: { key: 'open-settings', type: 'navigate', label: 'Open System & Alerts', href: '/settings' },
      },
    })])
  }

  const deliveryMode = (await runtime.capabilities()).delivery.mode
  if (deliveryMode === 'native') {
    return healthObserved([healthHealthy({
      key: 'idle',
      summary: 'Discord bridge is configured but idle — the active runtime delivers natively.',
      detail: 'By design (D11): the runtime\'s own bot owns Discord; two consumers on one token would double-handle messages.',
      evidence: { deliveryMode },
    })])
  }

  if (!isDeliveryBridgeConnected()) {
    return healthObserved([healthWarning({
      key: 'connection',
      summary: 'Discord bridge is configured but not connected.',
      detail: 'The gateway connection is down or boot failed — check server logs and restart the server. If the bot ever answers twice after recovery, stop the OpenClaw daemon (same token, two consumers).',
      incident: {
        key: 'bridge-down',
        title: 'Discord delivery bridge is down',
        class: 'service_failure',
        impact: 'Channel alerts, gate approval cards, and inbound Discord chat are not being delivered.',
        disposition: 'action_required',
        resources: [{ kind: 'setting', id: 'integrations.discord', label: 'Discord integration' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun after restarting the server' },
      },
    })])
  }

  const notices = []
  if (settings.approvers.length === 0) {
    notices.push(healthWarning({
      key: 'approvers',
      summary: 'No Discord approvers are configured — approval buttons deny everyone (fail closed).',
      detail: 'Set integrations.discord.approvers to the Discord user IDs allowed to decide gates.',
      incident: {
        key: 'empty-approvers',
        title: 'Discord approval buttons are locked',
        class: 'policy_denial',
        impact: 'Gate cards render in Discord but every click is denied until an approver is allowlisted.',
        disposition: 'watch',
        resources: [{ kind: 'setting', id: 'integrations.discord', label: 'Discord integration' }],
        resolution: { key: 'open-settings', type: 'navigate', label: 'Open System & Alerts', href: '/settings' },
      },
    }))
  }
  // NOTE: no inbound-allowlist notice yet — inbound chat is not built
  // (Phase B). A doctor finding must never describe behavior that doesn't
  // exist; Phase B reintroduces it alongside the real MessageCreate consumer.
  if (notices.length > 0) return healthObserved([notices[0], ...notices.slice(1)])

  return healthObserved([healthHealthy({
    key: 'connection',
    summary: `Discord bridge is connected (${settings.guildIds.length} guild${settings.guildIds.length === 1 ? '' : 's'}, ${settings.approvers.length} approver${settings.approvers.length === 1 ? '' : 's'}).`,
    evidence: {
      guilds: settings.guildIds.length,
      approvers: settings.approvers.length,
      inbound: settings.inbound.enabled,
    },
  })])
}
