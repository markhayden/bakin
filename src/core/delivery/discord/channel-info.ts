/**
 * Map Discord API channel objects to the neutral ChannelInfo shape.
 * Only text-capable guild channels are listed; threads are addressable via
 * refs but not enumerated (matches how operators think about "channels").
 */
import type { ChannelCapability, ChannelInfo } from '@bakin/core/adapters/runtime'
import { discordChannelRef } from './refs'

/** Discord API channel types the bridge lists (GUILD_TEXT, GUILD_ANNOUNCEMENT). */
const TEXT_CHANNEL_TYPES = new Set([0, 5])

const BRIDGE_CHANNEL_CAPABILITIES: ChannelCapability[] = [
  'message',
  'rich-content',
  'interactive-approval',
  'modal-input',
  'threaded-replies',
  'edit-after-send',
  'cancel-rendered',
]

export interface ApiChannelLike {
  id: string
  name?: string | null
  type: number
}

export function channelInfoFromApiChannel(raw: ApiChannelLike): ChannelInfo | null {
  if (!TEXT_CHANNEL_TYPES.has(raw.type)) return null
  return {
    id: discordChannelRef(raw.id),
    platform: 'discord',
    label: raw.name ? `#${raw.name}` : raw.id,
    capabilities: [...BRIDGE_CHANNEL_CAPABILITIES],
    metadata: {
      approvalResponses: 'interactive',
      approvalMode: 'discord-bridge',
      rejectReason: 'modal',
    },
  }
}
