/**
 * delivery.discord doctor check (#669 A7, reshaped by #908 §4.7): a
 * PROJECTION of the ONE channel-readiness snapshot. Native runtime first
 * (D14) — a token-less bridge block on OpenClaw is idle configuration,
 * never an incident. Every non-ready state is one incident with a stable
 * key and a navigate resolution into Settings → Channels; the Channels tab
 * and this check can never disagree because they read the same snapshot.
 */
import { CHANNELS_SETTINGS_HREF, DELIVERABLE_STATES, type ChannelReadiness } from '@bakin/core/delivery'
import { healthHealthy, healthNotApplicable, healthObserved, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthIncidentDeclaration, HealthRepairActionDefinition, HealthResolution, HealthSubject } from '@makinbakin/sdk'
import { repairTargetSelection } from '@bakin/core/health/repair-support'
import { readDiscordConfig } from '../../../../src/core/delivery/config'
import { CHANNEL_HEALTH_CHECK_IDS, getChannelReadiness, reconnectDeliveryBridge } from '../../../../src/core/delivery/readiness'

export const DISCORD_BRIDGE_RECONNECT_ACTION = 'discord-bridge-reconnect'
/** How long the repair waits for the bridge to settle before judging (the route's long-poll uses the same figure). */
export const RECONNECT_WAIT_MS = 45_000

const SUBJECT: HealthSubject = { kind: 'channel', id: 'discord', label: 'Discord delivery bridge' }
/** Rows 21–22 and 24 (credential variant) are the operator's; 24 (other causes) and 25 reconnect; 26 is a decision on the servers field; 23, 27, 28 are observations. */
export const DELIVERY_DISCORD_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'missing-token', subjectKind: 'channel', resolution: { type: 'human', needs: 'credential' }, required: 'always' },
  { id: 'missing-guild', subjectKind: 'channel', resolution: { type: 'human', needs: 'decision' }, required: 'always' },
  { id: 'bridge-failed-credential', subjectKind: 'channel', resolution: { type: 'human', needs: 'credential' }, required: 'always' },
  { id: 'bridge-failed', subjectKind: 'channel', resolution: { type: 'repair', actionId: DISCORD_BRIDGE_RECONNECT_ACTION }, required: 'always' },
  { id: 'bridge-disconnected', subjectKind: 'channel', resolution: { type: 'repair', actionId: DISCORD_BRIDGE_RECONNECT_ACTION }, required: 'always' },
  { id: 'guild-unjoined', subjectKind: 'channel', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' },
]
const tokenCredential: HealthResolution = { key: 'open-channels', type: 'human', needs: 'credential', label: 'Set the bot token in Settings → Channels', href: `${CHANNELS_SETTINGS_HREF}&field=integrations.discord.botToken`, field: 'secret-slot-discord-botToken' }
const guildsDecision = (label: string): HealthResolution => ({ key: 'open-channels', type: 'human', needs: 'decision', label, href: `${CHANNELS_SETTINGS_HREF}&field=integrations.discord.guildIds`, field: 'channels-field-guilds' })
const reconnect: HealthResolution = { key: DISCORD_BRIDGE_RECONNECT_ACTION, type: 'repair', label: 'Reconnect the Discord bridge', actionId: DISCORD_BRIDGE_RECONNECT_ACTION }
const discordSetting = [{ kind: 'setting' as const, id: 'integrations.discord', label: 'Discord integration' }]

/** A rejected token or refused intents need the operator; anything else is the bridge's own reconnect (rows 24–25). */
function credentialFailure(readiness: ChannelReadiness): boolean {
  const kind = readiness.connection.lastError?.kind
  return kind === 'auth_failed' || kind === 'intents'
}

/**
 * Row 26's usage fact: does a CONFIGURED channel (alert channel, approvals
 * channel while enabled, an alias) live in a server the bridge cannot
 * reach? The snapshot lists every channel of every REACHABLE server, so a
 * configured target that resolves to no known channel is one the
 * unreachable server(s) must hold → required. Every target placed in a
 * reachable server (or none configured) → nothing blocked → advisory.
 * `unverifiable` (no channel list at all) is unknown — never presumed.
 */
export function guildUsage(readiness: ChannelReadiness): { required: boolean; usageKnown: boolean; configured: string[]; unplaced: string[] } {
  const targets = [
    readiness.routing.alertChannel,
    ...(readiness.routing.approvalsEnabled ? [readiness.routing.approvalsChannel] : []),
    ...readiness.routing.aliases,
  ].filter((target) => target.resolved !== 'unset')
  const unverifiable = targets.some((target) => target.resolved === 'unverifiable')
  const unplaced = targets.filter((target) => target.resolved === 'unknown_channel').map((target) => target.setting)
  return { required: unplaced.length > 0, usageKnown: !unverifiable, configured: targets.map((target) => target.setting), unplaced }
}

function incident(
  readiness: ChannelReadiness,
  key: string,
  title: string,
  impact: string,
  summary: string,
  resolution: HealthResolution,
  declarationId = key,
  required?: boolean,
  extraEvidence: Record<string, unknown> = {},
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
      ...extraEvidence,
    },
    incident: {
      key,
      title,
      class: 'service_failure',
      impact,
      // `required` and the disposition agree: an owner-decides verdict of false is advisory, never red on a guess.
      disposition: required === false ? 'advisory' : 'action_required',
      subject: SUBJECT,
      declarationId,
      ...(required === undefined ? {} : { required }),
      resources: discordSetting,
      resolution,
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
        'Discord bridge is enabled but no bot token is stored.', tokenCredential)])
    case 'missing_guild':
      return healthObserved([incident(readiness, 'missing-guild', 'Discord bridge has no guilds to serve',
        'The bridge has no channels to enumerate or deliver to.',
        'Discord bridge is enabled but no guild IDs are configured.', guildsDecision('Add a server in Settings → Channels'))])
    case 'connecting':
      // Watch, not action: an attempt is in flight and the READY deadline
      // bounds it. The targeted rerun's debounce means a healthy connect
      // rarely records this at all.
      return healthObserved([healthWarning({
        key: 'connecting',
        summary: 'Discord bridge is connecting.',
        detail: 'An attempt is in flight; the READY deadline bounds it. No action yet — channel delivery resumes once the gateway reports READY.',
        evidence: {
          since: readiness.connection.since,
          attempt: readiness.connection.attempt ? { generation: readiness.connection.attempt.generation, startedAt: readiness.connection.attempt.startedAt } : null,
        },
      })])
    case 'failed':
      return healthObserved([incident(readiness, 'bridge-failed', 'Discord delivery bridge failed to connect',
        'Channel alerts, gate approval cards, and inbound Discord chat are not being delivered.',
        `Discord bridge failed to connect${readiness.connection.lastError ? ` (${readiness.connection.lastError.kind}: ${readiness.connection.lastError.message})` : ''}.`,
        credentialFailure(readiness) ? tokenCredential : reconnect,
        credentialFailure(readiness) ? 'bridge-failed-credential' : 'bridge-failed')])
    case 'disconnected':
      return healthObserved([incident(readiness, 'bridge-disconnected', 'Discord delivery bridge is disconnected',
        'Channel alerts, gate approval cards, and inbound Discord chat are not being delivered until the gateway resumes.',
        'Discord bridge lost its gateway connection.', reconnect)])
    case 'degraded': {
      const missing = readiness.guilds.filter((guild) => guild.joined !== true || guild.channelCount === null || guild.error)
      // Row 26: required while a configured channel lives in that server — a
      // FACT from the routing targets (a target no reachable server holds),
      // never a presumption about configured servers (Codex r2 r1 #11).
      const usage = guildUsage(readiness)
      return healthObserved([incident(readiness, 'guild-unjoined', 'Discord bridge cannot reach every configured server',
        usage.required
          ? `Configured channel${usage.unplaced.length === 1 ? '' : 's'} (${usage.unplaced.join(', ')}) resolve to no reachable server, so those posts fail; the other servers still deliver.`
          : usage.usageKnown
            ? 'No configured channel lives in the unreachable server, so nothing is blocked; invite the bot or remove the server when convenient.'
            : 'Whether a configured channel lives in the unreachable server is unknown (no channel list); posts there would fail.',
        `Discord bridge is connected but ${missing.length} configured server${missing.length === 1 ? ' is' : 's are'} not reachable: ${missing.map((guild) => guild.id).join(', ')}.`,
        // Invite the bot to the server (the Channels tab offers the invite link beside the field) or remove the id (row 26).
        guildsDecision('Invite the bot or remove the server'), 'guild-unjoined', usage.required,
        { usageKnown: usage.usageKnown, configuredTargets: usage.configured, unplacedTargets: usage.unplaced })])
    }
    case 'connected':
      break
  }

  const notices = []
  if (settings.approvers.length === 0) {
    // Row 27: an observation; the field is named in the detail.
    notices.push(healthWarning({
      key: 'approvers',
      summary: 'No Discord approvers are configured — approval buttons deny everyone (fail closed).',
      detail: `Gate cards render in Discord but every click is denied until an approver is allowlisted. Set the approvers list to the Discord user IDs allowed to decide gates: ${CHANNELS_SETTINGS_HREF}&field=integrations.discord.approvers`,
      evidence: { setting: 'integrations.discord.approvers', approvers: 0 },
    }))
  }
  if (settings.inbound.enabled && settings.inbound.allowFrom.length === 0) {
    // Row 28: an observation; the field is named in the detail.
    notices.push(healthWarning({
      key: 'inbound-allowlist',
      summary: 'Discord inbound chat is on but the allowlist is empty — every sender is ignored (fail closed).',
      detail: `Messages at the bot are silently denied (audited) until a sender is allowlisted. Set the inbound allowlist to the Discord user IDs allowed to chat: ${CHANNELS_SETTINGS_HREF}&field=integrations.discord.inbound.allowFrom`,
      evidence: { setting: 'integrations.discord.inbound.allowFrom', allowFrom: 0 },
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

/**
 * `discord-bridge-reconnect` (self-healing PR1 slice 1.3c): the bridge's own
 * operator reconcile as a repair — the same helper `POST /api/channels/reconnect`
 * runs — judged by the refreshed readiness snapshot.
 */
export function discordBridgeReconnectRepair(): HealthRepairActionDefinition {
  return {
    id: DISCORD_BRIDGE_RECONNECT_ACTION,
    name: 'Reconnect the Discord bridge',
    effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: false },
    mutation: 'restart',
    operationPlan: () => ({
      stages: [
        { id: 'reconnect', kind: 'installing', label: 'Reconnect the bridge' },
        { id: 'verify', kind: 'verifying', label: 'Wait for the gateway' },
      ],
      pointOfNoReturn: 'reconnect',
    }),
    async plan(target) {
      return [{
        id: DISCORD_BRIDGE_RECONNECT_ACTION,
        actionId: DISCORD_BRIDGE_RECONNECT_ACTION,
        title: 'Reconnect the Discord bridge',
        reason: 'The bridge lost its gateway connection or failed to connect for a reason that is not a credential.',
        ...repairTargetSelection(target),
        changes: [{ kind: 'service', target: 'discord bridge', action: 'update', description: 'Reconcile the bridge to the current configuration (a fresh gateway connection) and wait for READY. No message is sent.' }],
      }]
    },
    async apply(items, op) {
      if (items.length === 0) return []
      const result = (status: 'applied' | 'failed' | 'skipped', message: string) => items.map((item) => ({ itemId: item.id, actionId: item.actionId, status, message, affectedCheckIds: [...CHANNEL_HEALTH_CHECK_IDS], changes: item.changes }))
      op.stage('reconnect')
      const outcome = await reconnectDeliveryBridge({ waitMs: RECONNECT_WAIT_MS })
      if (outcome.outcome === 'owner_is_runtime') return result('skipped', 'The active runtime delivers natively; the Bakin bridge is idle by design and was not touched.')
      op.stage('verify')
      const { connection } = outcome.readiness
      if (DELIVERABLE_STATES.includes(connection.state)) return result('applied', `The Discord bridge is ${connection.state} again.`)
      const why = connection.lastError ? ` (${connection.lastError.kind}: ${connection.lastError.message})` : ''
      return result('failed', `The Discord bridge is still ${connection.state} after ${Math.round(RECONNECT_WAIT_MS / 1000)}s${why}.`)
    },
  }
}
