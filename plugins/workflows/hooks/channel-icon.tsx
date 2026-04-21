'use client'

import {
  HelpCircle,
  Instagram,
  Mail,
  MessageSquare,
  Music2,
  Twitter,
  Youtube,
  type LucideIcon,
} from 'lucide-react'
import { useNotificationChannels } from './use-notification-channels'

/**
 * Explicit lucide name → component map. We avoid `import * as Lucide` because
 * that bundles the entire icon set (~1000 icons) into the client. Channel
 * icons beyond this set (contributed by third-party plugins) render as
 * HelpCircle until we expand the map or switch to a different strategy.
 */
const CHANNEL_ICON_MAP: Record<string, LucideIcon> = {
  HelpCircle,
  Instagram,
  Mail,
  MessageSquare,
  Music2,
  Twitter,
  Youtube,
}

interface ChannelIconProps {
  channelId: string
  className?: string
}

export function ChannelIcon({ channelId, className }: ChannelIconProps) {
  const channels = useNotificationChannels()
  const channel = channels.find((c) => c.id === channelId)
  const Icon = (channel?.icon && CHANNEL_ICON_MAP[channel.icon]) ?? HelpCircle
  return <Icon className={className} />
}
