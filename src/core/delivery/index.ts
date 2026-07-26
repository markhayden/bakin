/**
 * Delivery bridge singleton + boot gating (D11).
 *
 * The bridge HANDLE is cheap and always constructible (adapters receive it
 * via AdapterInitOpts at createAppServices time); the Discord transport only
 * connects in bootDeliveryBridge(), which the SERVER calls after
 * createAppServices — never inside it (read-only CLI paths also build app
 * services). The transport module is dynamically imported at boot so CLI and
 * doctor paths never pay for (or evaluate) @discordjs.
 */
import type { CapabilityMode } from '@bakin/core/adapters/runtime'
import type { ChannelBridge, ChannelSurface } from '@bakin/core/delivery'
import { createLogger } from '@/core/logger'
import { isDiscordConfigured, readDiscordConfig } from './config'
import { auditDelivery } from './audit'
import type { DiscordTransport } from './discord/client'
import type { ChannelCache } from './discord/channel-cache'
import type { SendSurface } from './discord/send'

const log = createLogger('delivery')

export interface BridgeState {
  transport: DiscordTransport
  cache: ChannelCache
  send: SendSurface
}

let state: BridgeState | null = null

function requireState(): BridgeState {
  if (!state) throw new Error('Discord delivery bridge is not connected (server boot pending or bridge disabled)')
  return state
}

/** Placeholder until the send (A4) and approval (A5) surfaces land. */
function notImplemented(surface: string): never {
  throw new Error(`Discord delivery bridge: ${surface} not implemented yet`)
}

const channels: ChannelSurface = {
  list: async () => requireState().cache.list(),
  sendNotification: async (args) => requireState().send.sendNotification(args),
  sendMessage: async (args) => requireState().send.sendMessage(args),
  deliverContent: async (args) => requireState().send.deliverContent(args),
  createApproval: async () => notImplemented('createApproval'),
  editApproval: async () => notImplemented('editApproval'),
  cancelApproval: async () => notImplemented('cancelApproval'),
  resolveApproval: async () => notImplemented('resolveApproval'),
  subscribeApprovalResponses: () => notImplemented('subscribeApprovalResponses'),
  createThread: async (args) => requireState().send.createThread(args),
  editMessage: async (args) => requireState().send.editMessage(args),
}

const bridge: ChannelBridge = {
  isConfigured: () => isDiscordConfigured(),

  async boot() {
    if (state) return
    const { settings, token } = readDiscordConfig()
    if (!isDiscordConfigured() || !token) return
    const { createDiscordTransport, sendApiFromTransport } = await import('./discord/client')
    const { createChannelCache } = await import('./discord/channel-cache')
    const { createSendSurface } = await import('./discord/send')
    const transport = createDiscordTransport(token)
    await transport.connect()
    const cache = createChannelCache({
      guildIds: settings.guildIds,
      fetchGuildChannels: transport.fetchGuildChannels,
    })
    // Populate eagerly so list() is instant and a bad guild id fails loudly
    // at boot, not on first use. Non-fatal: the gateway is already up.
    try {
      await cache.refresh()
    } catch (err) {
      log.warn('Discord channel enumeration failed at boot', err)
    }
    const send = createSendSurface({ api: sendApiFromTransport(transport) })
    state = { transport, cache, send }
    auditDelivery('delivery.connected', { guilds: settings.guildIds.length })
  },

  async shutdown() {
    if (!state) return
    const closing = state
    state = null
    await closing.transport.destroy()
    auditDelivery('delivery.disconnected', {})
  },

  channels,
}

export function getDeliveryBridge(): ChannelBridge {
  return bridge
}

/** Exposed for A4/A5 surface modules; throws until boot() connects. */
export function getBridgeState(): BridgeState {
  return requireState()
}

/**
 * D11: the bridge serves runtimes WITHOUT native delivery. On a natively-
 * delivering runtime (OpenClaw) the same bot token is already consumed by
 * the runtime's own Discord connection — two consumers would double-handle.
 */
export function shouldBootDeliveryBridge(configured: boolean, deliveryMode: CapabilityMode): boolean {
  return configured && deliveryMode !== 'native'
}

export async function bootDeliveryBridge(
  runtime: { capabilities(): Promise<{ delivery: { mode: CapabilityMode } }> },
): Promise<boolean> {
  const configured = isDiscordConfigured()
  const mode = (await runtime.capabilities()).delivery.mode
  if (!shouldBootDeliveryBridge(configured, mode)) {
    if (configured && mode === 'native') {
      log.info('Delivery bridge skipped: active runtime delivers natively')
    }
    return false
  }
  await bridge.boot()
  log.info('Discord delivery bridge connected')
  return true
}

export async function shutdownDeliveryBridge(): Promise<void> {
  await bridge.shutdown()
}
