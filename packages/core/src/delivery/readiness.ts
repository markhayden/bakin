/**
 * Channel readiness — neutral wire types + the two PURE functions every
 * surface projects from (channel-readiness spec §4.1).
 *
 * - `classifyChannelReadiness` OBSERVES: it needs the bridge's live status.
 * - `projectChannelReadiness` PREVIEWS (runtime switch): no bridge input, so
 *   a configured-but-unprobed target is `ready_to_connect`, never a failure.
 *
 * No I/O here. The app-side collector (`src/core/delivery/readiness.ts`)
 * gathers the facts and publishes the snapshot.
 */
import type { CapabilityMode } from '../adapters/runtime/capabilities'
import type { ChannelInfo } from '../adapters/runtime/channels'

/** One cause / next-step for a non-deliverable state (filled by ./copy). */
export interface ReadinessRemediation {
  /** One sentence: what is wrong. */
  summary: string
  /** One sentence: what to do. */
  nextStep: string
  /** Where to do it (app-relative). */
  href: string
  /** The action the Channels tab offers inline. */
  action: 'enable' | 'add_token' | 'add_guild' | 'reconnect' | 'replace_token' | 'fix_intents' | 'wait' | null
}

export type DeliveryErrorKind =
  /** Disabled, no token, or no guild — the readiness state says which (`detail.state`). */
  | 'not_configured'
  /** Configured but the transport is not up (connecting/disconnected/failed — `detail.state`). */
  | 'not_connected'
  /** Discord rejected the bot token (REST 401 or gateway close 4004). */
  | 'auth_failed'
  /** Discord refused the gateway intents (close 4013/4014 — portal toggle missing). */
  | 'intents'
  /** The target channel/guild is unknown to a connected bridge (REST 404 or unjoined guild). */
  | 'target_not_found'
  /** The bot lacks permission on the target (REST 403). */
  | 'forbidden'
  /** Discord refused the request deterministically (other 4xx); no retry was attempted. */
  | 'rejected'
  /** READY or HTTP deadline elapsed. */
  | 'timeout'
  /** Network / 5xx / everything else, after retries where retries apply. */
  | 'transport'

/** Wire-safe summary (never carries the token or a stack). */
export interface DeliveryErrorSummary {
  kind: DeliveryErrorKind
  message: string
  at: string
}

export type ChannelReadinessState =
  | 'native'          // the runtime delivers natively — the Bakin bridge is idle by design
  | 'disabled'        // integrations.discord.enabled === false
  | 'missing_token'   // enabled, no token (env or store)
  | 'missing_guild'   // enabled, token, guildIds.length === 0
  | 'connecting'      // an attempt is in flight
  | 'connected'       // gateway READY, every configured guild joined + enumerated
  | 'degraded'        // connected, but ≥1 configured guild not joined or enumeration failed
  | 'disconnected'    // gateway dropped after a successful connect
  | 'failed'          // the last attempt failed (see lastError), or never attempted

/** Preview-only states for the runtime-switch report. */
export type ProjectedChannelState =
  | 'native' | 'disabled' | 'missing_token' | 'missing_guild' | 'ready_to_connect'

export type ChannelOwner = 'runtime' | 'bridge' | 'none'

export interface RoutingTarget {
  /** Settings key, e.g. 'notifications.channel' or 'notifications.channelAliases.alerts'. */
  setting: string
  /** Configured ref/alias; null = unset. */
  value: string | null
  /** `unverifiable` = no channel list was available to check against. */
  resolved: 'ok' | 'unset' | 'unknown_channel' | 'unverifiable'
  channelId?: string
}

export interface GuildReadiness {
  id: string
  name?: string
  /** null = not yet known (no READY seen for this configuration). */
  joined: boolean | null
  channelCount: number | null
  error?: DeliveryErrorSummary
}

/** What the bridge itself knows — no settings, no runtime. */
export interface BridgeStatus {
  state: 'idle' | 'connecting' | 'connected' | 'degraded' | 'disconnected' | 'failed'
  /** Timestamp of the last STATE transition; stable across refreshes. */
  since: string
  lastError: DeliveryErrorSummary | null
  botUser?: { id: string; name: string }
  joinedGuildIds: string[]
  guildResults: GuildReadiness[]
  /** The last APPLIED configuration generation. */
  generation: number
  /** Present while an attempt is in flight. */
  attempt?: { generation: number; startedAt: string }
}

export interface ChannelReadiness {
  runtime: { adapter: string; deliveryMode: CapabilityMode }
  owner: ChannelOwner
  enabled: boolean
  /** Presence + source only — never the value. */
  token: { present: boolean; source: 'env' | 'store' | null }
  guilds: GuildReadiness[]
  connection: {
    state: ChannelReadinessState
    since: string
    lastError: DeliveryErrorSummary | null
    botUser?: { id: string; name: string }
    attempt?: { generation: number; startedAt: string }
  }
  channels: {
    items: ChannelInfo[]
    source: 'bridge' | 'runtime' | 'none'
    collectedAt: string | null
    error?: DeliveryErrorSummary
  }
  routing: {
    alertChannel: RoutingTarget
    approvalsChannel: RoutingTarget
    approvalsEnabled: boolean
    aliases: RoutingTarget[]
  }
  /** The one cause/next-step for a non-deliverable state (copy table); null when ready. */
  remediation: ReadinessRemediation | null
  generatedAt: string
}

export interface ProjectionFacts {
  deliveryMode: CapabilityMode
  enabled: boolean
  tokenPresent: boolean
  guildCount: number
}

export interface ReadinessFacts extends ProjectionFacts {
  bridge: BridgeStatus
}

/** The states that mean "the bridge can deliver right now". */
export const DELIVERABLE_STATES: readonly ChannelReadinessState[] = ['connected', 'degraded']

/** The states that are configuration gaps (nothing to connect). */
export const NOT_CONFIGURED_STATES: readonly ChannelReadinessState[] = ['disabled', 'missing_token', 'missing_guild']

function configurationGap(facts: ProjectionFacts): 'native' | 'disabled' | 'missing_token' | 'missing_guild' | null {
  if (facts.deliveryMode === 'native') return 'native'
  if (!facts.enabled) return 'disabled'
  if (!facts.tokenPresent) return 'missing_token'
  if (facts.guildCount === 0) return 'missing_guild'
  return null
}

function everyGuildReady(bridge: BridgeStatus, guildCount: number): boolean {
  if (bridge.guildResults.length < guildCount) return false
  return bridge.guildResults.every((guild) => guild.joined === true && guild.channelCount !== null && !guild.error)
}

/**
 * Observation. Precedence (first match wins): native > disabled >
 * missing_token > missing_guild > connecting > connected > degraded >
 * disconnected > failed. An idle bridge under a configured, non-native
 * runtime was never attempted — that is `failed`, because the classifier
 * must never invent `connected`.
 */
export function classifyChannelReadiness(facts: ReadinessFacts): ChannelReadinessState {
  const gap = configurationGap(facts)
  if (gap) return gap
  const { bridge } = facts
  if (bridge.state === 'connecting' || bridge.attempt) return 'connecting'
  switch (bridge.state) {
    case 'connected':
      return everyGuildReady(bridge, facts.guildCount) ? 'connected' : 'degraded'
    case 'degraded':
      return 'degraded'
    case 'disconnected':
      return 'disconnected'
    case 'failed':
    case 'idle':
      return 'failed'
  }
}

/** Projection for previews: the configuration gaps, else "ready to connect". */
export function projectChannelReadiness(facts: ProjectionFacts): ProjectedChannelState {
  return configurationGap(facts) ?? 'ready_to_connect'
}

export function readinessOwner(deliveryMode: CapabilityMode, hasSurface: boolean): ChannelOwner {
  if (deliveryMode === 'native') return 'runtime'
  return hasSurface ? 'bridge' : 'none'
}
