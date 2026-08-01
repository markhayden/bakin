/**
 * Guild channel cache (D3): enumerate once at boot, serve cached, refresh on
 * demand. A failed refresh serves the last-known list (stale beats broken);
 * a never-populated cache throws honestly.
 */
import type { ChannelInfo } from '@bakin/core/adapters/runtime'
import { createLogger } from '@/core/logger'
import { channelInfoFromApiChannel, type ApiChannelLike } from './channel-info'

const log = createLogger('delivery-channels')

export interface ChannelCacheDeps {
  guildIds: string[]
  fetchGuildChannels(guildId: string): Promise<ApiChannelLike[]>
}

export interface ChannelCache {
  list(): Promise<ChannelInfo[]>
  refresh(): Promise<ChannelInfo[]>
}

export function createChannelCache(deps: ChannelCacheDeps): ChannelCache {
  let cached: ChannelInfo[] | null = null

  async function fetchAll(): Promise<ChannelInfo[]> {
    const infos: ChannelInfo[] = []
    for (const guildId of deps.guildIds) {
      const channels = await deps.fetchGuildChannels(guildId)
      for (const channel of channels) {
        const info = channelInfoFromApiChannel(channel)
        if (info) infos.push(info)
      }
    }
    return infos
  }

  async function refresh(): Promise<ChannelInfo[]> {
    try {
      cached = await fetchAll()
    } catch (err) {
      if (!cached) throw err
      log.warn('Discord channel refresh failed — serving last-known list', err)
    }
    return cached
  }

  return {
    async list() {
      if (cached) return cached
      return refresh()
    },
    refresh,
  }
}
