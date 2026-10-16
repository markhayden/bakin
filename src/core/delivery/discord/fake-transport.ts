/**
 * FAKE Discord transport (spec D15). Selected by the bridge ONLY when
 * `BAKIN_DELIVERY_TRANSPORT=fake` (the server logs a loud warning). It has
 * the same module surface as ./client so the reconciliation loop, the
 * readiness collector, the health projections, the routes, and the CLI all
 * run for real on top of it — with no sockets and no sends. Scenario via
 * `BAKIN_DELIVERY_FAKE`:
 *
 *   ready[:g1,g2]   READY immediately; joined guilds = the list, or every
 *                   configured guild when omitted (default)
 *   reject-401      connect fails like a bogus token (REST 401 → auth_failed)
 *   hang            never READY; only an abort or the deadline ends it
 *
 * Every joined guild enumerates two text channels; sends are recorded in
 * memory and never leave the process.
 */
import { DeliveryError, type DeliveryErrorSummary } from '@bakin/core/delivery'
import { createLogger } from '@/core/logger'
import { readDiscordConfig } from '../config'
import type { ApiChannelLike } from './channel-info'
import type { DiscordTransport, TransportEvent, TransportOptions, TransportStatus } from './client'
import type { SendApi } from './send'
import type { ApprovalApi, RawInteraction } from './approvals'
import type { RawInboundMessage } from './inbound'

const log = createLogger('delivery-fake')

export const FAKE_SCENARIO_ENV = 'BAKIN_DELIVERY_FAKE'

export type FakeScenario =
  | { kind: 'ready'; guildIds: string[] | null }
  | { kind: 'reject-401' }
  | { kind: 'hang' }

export function parseFakeScenario(raw: string | undefined): FakeScenario {
  const value = (raw ?? 'ready').trim()
  if (value === 'reject-401') return { kind: 'reject-401' }
  if (value === 'hang') return { kind: 'hang' }
  if (value === 'ready') return { kind: 'ready', guildIds: null }
  if (value.startsWith('ready:')) {
    const ids = value.slice('ready:'.length).split(',').map((id) => id.trim()).filter(Boolean)
    return { kind: 'ready', guildIds: ids }
  }
  throw new Error(`Unknown ${FAKE_SCENARIO_ENV} scenario: ${value}`)
}

export interface FakeSentMessage {
  channelId: string
  content?: string
  at: string
}

/** Every message the fake "sent", for assertions (process-local). */
export const fakeSentMessages: FakeSentMessage[] = []

function fakeChannels(guildId: string): ApiChannelLike[] {
  return [
    { id: `${guildId}01`, name: 'general', type: 0 },
    { id: `${guildId}02`, name: 'alerts', type: 0 },
  ]
}

export function createDiscordTransport(_token: string, _options: TransportOptions = {}): DiscordTransport {
  const scenario = parseFakeScenario(process.env[FAKE_SCENARIO_ENV])
  let phase: TransportStatus['phase'] = 'idle'
  let readyGuildIds: string[] = []
  let lastError: DeliveryErrorSummary | null = null
  let disposed = false
  const listeners = new Set<(event: TransportEvent) => void>()
  const botUser = { id: 'fake-bot', name: 'Fake Bot' }
  const joinedGuilds = () => (scenario.kind === 'ready' ? scenario.guildIds ?? readDiscordConfig().settings.guildIds : [])

  const api = {
    users: {
      getGuilds: async () => joinedGuilds().map((id) => ({ id, name: `Guild ${id}`, icon: null, banner: null, owner: false, features: [], permissions: String((BigInt(1) << BigInt(10)) | (BigInt(1) << BigInt(11))) })),
    },
    guilds: {
      getChannels: async (guildId: string) => {
        if (!joinedGuilds().includes(guildId)) {
          const err = new Error('Missing Access') as Error & { status: number }
          err.status = 403
          throw err
        }
        return fakeChannels(guildId)
      },
    },
  }

  return {
    api: api as unknown as DiscordTransport['api'],
    client: {} as DiscordTransport['client'],
    botUserId: () => (phase === 'ready' ? botUser.id : null),
    applicationId: () => (phase === 'ready' ? 'fake-app' : null),
    async connect(opts = {}) {
      if (disposed) throw new DeliveryError('transport', 'fake transport destroyed')
      phase = 'connecting'
      log.warn('FAKE Discord transport connecting', { scenario: scenario.kind })
      if (scenario.kind === 'reject-401') {
        phase = 'closed'
        const err = new DeliveryError('auth_failed', 'Discord rejected the bot token (401)', { status: 401 })
        lastError = { kind: err.kind, message: err.message, at: new Date().toISOString() }
        disposed = true
        throw err
      }
      if (scenario.kind === 'hang') {
        await new Promise<void>((_resolve, reject) => {
          const onAbort = () => reject(new DeliveryError('transport', 'Discord connect aborted'))
          if (opts.signal?.aborted) onAbort()
          else opts.signal?.addEventListener('abort', onAbort, { once: true })
        })
        return
      }
      readyGuildIds = joinedGuilds()
      phase = 'ready'
      for (const listener of listeners) listener({ type: 'ready', guildIds: readyGuildIds, botUser })
    },
    async destroy() {
      disposed = true
      phase = 'closed'
    },
    status: () => ({ phase, botUser: phase === 'ready' ? botUser : null, readyGuildIds, lastCloseCode: null, lastError }),
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async fetchGuildChannels(guildId) {
      return api.guilds.getChannels(guildId)
    },
  }
}

export function sendApiFromTransport(_transport: DiscordTransport): SendApi {
  return {
    async createMessage(channelId, payload) {
      const id = `fake-${fakeSentMessages.length + 1}`
      fakeSentMessages.push({ channelId, content: payload.content, at: new Date().toISOString() })
      return { id }
    },
    async editMessage() {},
    async startThread() { return { id: 'fake-thread' } },
    async createDM(userId) { return { id: `dm-${userId}` } },
    async showTyping() {},
  }
}

export function approvalApiFromTransport(_transport: DiscordTransport): ApprovalApi {
  return {
    async replyEphemeral() {},
    async updateComponentMessage() {},
    async openModal() {},
    async editMessage() {},
  }
}

export function subscribeInteractions(_transport: DiscordTransport, _handler: (raw: RawInteraction) => void): void {}
export function subscribeMessages(_transport: DiscordTransport, _handler: (raw: RawInboundMessage) => void): void {}
export async function downloadAttachment(_url: string): Promise<Buffer> {
  throw new DeliveryError('transport', 'fake transport never downloads')
}
export async function registerGlobalCommands(): Promise<void> {}
