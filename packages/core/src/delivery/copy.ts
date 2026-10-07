/**
 * The ONE cause / next-step copy table for channel delivery (spec §4.6, D6).
 * Shared by the readiness snapshot (Channels tab Banner), the post-channel
 * tool, the onboarding check, and the CLI — never a second phrasing anywhere.
 * Pure: no I/O, no secrets.
 */
import type { ChannelReadinessState, DeliveryErrorKind, DeliveryErrorSummary, ReadinessRemediation } from './readiness'

export const CHANNELS_SETTINGS_HREF = '/settings?tab=channels'

/** Why delivery is not ready, for every non-deliverable state. null = nothing to fix. */
export function remediationForState(
  state: ChannelReadinessState,
  lastError: DeliveryErrorSummary | null = null,
): ReadinessRemediation | null {
  switch (state) {
    case 'native':
    case 'connected':
      return null
    case 'disabled':
      return { summary: 'Discord delivery is disabled.', nextStep: 'Enable it in Settings → Channels.', href: CHANNELS_SETTINGS_HREF, action: 'enable' }
    case 'missing_token':
      return { summary: 'Discord is enabled but its bot token is missing.', nextStep: 'Add the token in Settings → Channels, then reconnect.', href: CHANNELS_SETTINGS_HREF, action: 'add_token' }
    case 'missing_guild':
      return { summary: 'Discord is enabled but no server is configured.', nextStep: 'Add a guild ID in Settings → Channels.', href: CHANNELS_SETTINGS_HREF, action: 'add_guild' }
    case 'connecting':
      return { summary: 'Discord bridge is still connecting.', nextStep: 'Retry in a few seconds.', href: CHANNELS_SETTINGS_HREF, action: 'wait' }
    case 'degraded':
      return { summary: 'Discord bridge is connected, but not every configured server is reachable.', nextStep: 'Check the server list in Settings → Channels: invite the bot to the missing server or remove its ID.', href: CHANNELS_SETTINGS_HREF, action: 'add_guild' }
    case 'disconnected':
      return { summary: `Discord bridge lost its connection${lastError ? ` (${lastError.message})` : ''}.`, nextStep: 'Use Reconnect in Settings → Channels.', href: CHANNELS_SETTINGS_HREF, action: 'reconnect' }
    case 'failed':
      return remediationForFailure(lastError)
  }
}

function remediationForFailure(lastError: DeliveryErrorSummary | null): ReadinessRemediation {
  switch (lastError?.kind) {
    case 'auth_failed':
      return { summary: 'Discord rejected the bot token.', nextStep: 'Replace it in Settings → Channels.', href: CHANNELS_SETTINGS_HREF, action: 'replace_token' }
    case 'intents':
      return { summary: "Discord refused the bot's gateway intents.", nextStep: 'Enable Message Content Intent for the bot in the Discord developer portal, then reconnect.', href: CHANNELS_SETTINGS_HREF, action: 'fix_intents' }
    case 'timeout':
      return { summary: 'Discord did not answer the connection in time.', nextStep: 'Use Reconnect in Settings → Channels.', href: CHANNELS_SETTINGS_HREF, action: 'reconnect' }
    case 'not_connected':
      return { summary: 'Discord bridge has not connected yet.', nextStep: 'Use Reconnect in Settings → Channels.', href: CHANNELS_SETTINGS_HREF, action: 'reconnect' }
    default:
      return { summary: `Discord bridge is not connected${lastError ? ` (${lastError.kind}: ${lastError.message})` : ''}.`, nextStep: 'Use Reconnect in Settings → Channels.', href: CHANNELS_SETTINGS_HREF, action: 'reconnect' }
  }
}

export interface DeliveryFailureCopy {
  cause: string
  nextStep: string
}

/**
 * What an agent (or the CLI) is told when ONE delivery fails, by kind. For
 * not_configured / not_connected the readiness state carries the precise
 * cause; everything else is about the target or the transport.
 */
export function deliveryFailureCopy(
  kind: DeliveryErrorKind,
  detail: {
    state?: ChannelReadinessState
    target?: string
    guildId?: string
    message?: string
    /** The bridge's recorded cause (readiness `connection.lastError`) — what a `failed`/`disconnected` state is really about. */
    lastError?: DeliveryErrorSummary | null
  } = {},
): DeliveryFailureCopy {
  switch (kind) {
    case 'not_configured':
    case 'not_connected': {
      const remediation = remediationForState(detail.state ?? 'failed', detail.lastError ?? null)
      return { cause: remediation?.summary ?? 'Discord delivery is not ready.', nextStep: remediation?.nextStep ?? 'Open Settings → Channels.' }
    }
    case 'auth_failed':
      return { cause: 'Discord rejected the bot token.', nextStep: 'Replace it in Settings → Channels.' }
    case 'intents':
      return { cause: "Discord refused the bot's gateway intents.", nextStep: 'Enable Message Content Intent for the bot in the Discord developer portal, then reconnect.' }
    case 'target_not_found':
      return {
        cause: `Channel ${detail.target ?? ''} is not in a connected server${detail.guildId ? ` (guild ${detail.guildId} is not joined)` : ''}.`.replace('  ', ' '),
        nextStep: 'Pick a channel from Settings → Channels.',
      }
    case 'forbidden':
      return { cause: `The bot lacks permission to post in ${detail.target ?? 'that channel'}.`, nextStep: 'Fix the channel permissions in Discord.' }
    case 'rejected':
      return { cause: `Discord rejected the post${detail.message ? `: ${detail.message}` : ''}.`, nextStep: 'No retry was attempted; fix the request and post again.' }
    case 'timeout':
    case 'transport':
      return { cause: `Discord delivery failed after retries${detail.message ? `: ${detail.message}` : ''}.`, nextStep: 'Retry later.' }
  }
}
