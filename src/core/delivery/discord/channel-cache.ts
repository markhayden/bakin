/**
 * Guild channel cache (D3, per-guild since #908): enumerate every configured
 * guild at apply time, record a PER-GUILD result so one bad guild never
 * hides the others, serve the union cached, refresh on demand. A failed
 * refresh serves the last-known list (stale beats broken); a cache that
 * never produced a single guild throws the first guild's typed error.
 */
import type { ChannelInfo } from '@bakin/core/adapters/runtime'
import { DeliveryError, type DeliveryErrorSummary, summarizeDeliveryError } from '@bakin/core/delivery'
import { createLogger } from '@/core/logger'
import { channelInfoFromApiChannel, type ApiChannelLike } from './channel-info'
import { classifyRestError } from './errors'

const log = createLogger('delivery-channels')

export interface ChannelCacheDeps {
  guildIds: string[]
  fetchGuildChannels(guildId: string): Promise<ApiChannelLike[]>
}

export interface GuildChannelResult {
  guildId: string
  /** null when the enumeration failed (see `error`). */
  channelCount: number | null
  error?: DeliveryErrorSummary
}

export interface ChannelCache {
  list(): Promise<ChannelInfo[]>
  refresh(): Promise<ChannelInfo[]>
  /** The cached list without fetching (null before the first successful refresh). */
  peek(): ChannelInfo[] | null
  /** Per-guild outcome of the last refresh ([] before the first). */
  guildResults(): GuildChannelResult[]
}

export function createChannelCache(deps: ChannelCacheDeps): ChannelCache {
  let cached: ChannelInfo[] | null = null
  let results: GuildChannelResult[] = []

  async function refresh(): Promise<ChannelInfo[]> {
    const infos: ChannelInfo[] = []
    const next: GuildChannelResult[] = []
    let firstError: DeliveryError | null = null
    for (const guildId of deps.guildIds) {
      try {
        const channels = await deps.fetchGuildChannels(guildId)
        let count = 0
        for (const channel of channels) {
          const info = channelInfoFromApiChannel(channel)
          if (info) {
            infos.push(info)
            count += 1
          }
        }
        next.push({ guildId, channelCount: count })
      } catch (err) {
        const typed = classifyRestError(err, { guildId })
        firstError ??= typed
        next.push({ guildId, channelCount: null, error: summarizeDeliveryError(typed) })
        log.warn('Discord guild channel enumeration failed', typed, { guildId, kind: typed.kind })
      }
    }
    results = next
    const anySucceeded = next.some((result) => result.channelCount !== null)
    if (anySucceeded || deps.guildIds.length === 0) {
      cached = infos
      return cached
    }
    if (cached) {
      log.warn('Discord channel refresh failed for every guild — serving last-known list')
      return cached
    }
    throw firstError ?? new DeliveryError('transport', 'Discord channel enumeration failed')
  }

  return {
    async list() {
      if (cached) return cached
      return refresh()
    },
    refresh,
    peek: () => cached,
    guildResults: () => results,
  }
}
