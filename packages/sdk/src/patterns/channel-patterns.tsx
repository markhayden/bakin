'use client'

import { useEffect, useState, type ReactNode } from 'react'

/**
 * The slice of a notification-channel definition the icon needs. Channel
 * definitions come from the workflows plugin's channel registry; plugins
 * that already hold them can pass `channels` and skip the fetch.
 */
export interface ChannelIconChannel {
  id: string
  /** Icon name from the channel registry (a known subset renders a glyph). */
  icon?: string
}

export interface ChannelIconProps {
  channelId: string
  className?: string
  /**
   * Channel definitions to resolve the icon from. Omit to resolve from the
   * live channel registry (`/api/plugins/workflows/notification-channels`,
   * cached module-wide — unknown or unreachable registries fall back to the
   * generic glyph, never an empty box).
   */
  channels?: readonly ChannelIconChannel[]
}

/**
 * Dependency-free 24×24 stroke glyphs for the registry's known icon names.
 * Third-party channels beyond this set render the generic glyph until the
 * map grows — an honest fallback, never a broken image.
 */
const CHANNEL_GLYPHS: Record<string, ReactNode> = {
  HelpCircle: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
    </>
  ),
  Instagram: (
    <>
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37zM17.5 6.5h.01" />
    </>
  ),
  Mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </>
  ),
  MessageSquare: (
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  ),
  Music2: (
    <>
      <circle cx="8" cy="18" r="4" />
      <path d="M12 18V2l7 4" />
    </>
  ),
  Twitter: (
    <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" />
  ),
  Youtube: (
    <>
      <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
      <path d="m10 15 5-3-5-3z" />
    </>
  ),
}

const CHANNELS_ENDPOINT = '/api/plugins/workflows/notification-channels'

/**
 * Module-level cache + single-flight promise: every icon on a page shares
 * one registry round-trip. Registry edits require a page reload (v1).
 */
let cachedChannels: ChannelIconChannel[] | null = null
let inFlight: Promise<ChannelIconChannel[]> | null = null

function fetchChannels(): Promise<ChannelIconChannel[]> {
  if (cachedChannels) return Promise.resolve(cachedChannels)
  if (inFlight) return inFlight
  inFlight = fetch(CHANNELS_ENDPOINT)
    .then((response) => (response.ok ? response.json() : null))
    .then((data: { channels?: ChannelIconChannel[] } | null) => {
      const list = data && Array.isArray(data.channels) ? data.channels : []
      cachedChannels = list
      return list
    })
    .catch(() => {
      cachedChannels = []
      return [] as ChannelIconChannel[]
    })
    .finally(() => { inFlight = null })
  return inFlight
}

/** Test/storybook-only: reset the module-level registry cache. */
export function __resetChannelIconCache(): void {
  cachedChannels = null
  inFlight = null
}

/**
 * Icon for a notification channel (Discord, Slack, email, …), resolved from
 * the workflows channel registry. Decorative by default — pair it with the
 * channel's visible label; it never carries meaning alone.
 */
export function ChannelIcon({ channelId, className, channels }: ChannelIconProps) {
  const [fetched, setFetched] = useState<ChannelIconChannel[]>(() => cachedChannels ?? [])

  useEffect(() => {
    if (channels || cachedChannels) return
    let cancelled = false
    fetchChannels().then((list) => {
      if (!cancelled) setFetched(list)
    })
    return () => { cancelled = true }
  }, [channels])

  const resolved = channels ?? fetched
  const iconName = resolved.find((channel) => channel.id === channelId)?.icon
  const glyph = (iconName && CHANNEL_GLYPHS[iconName]) || CHANNEL_GLYPHS.HelpCircle

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={24}
      height={24}
      data-channel-icon={channelId}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {glyph}
    </svg>
  )
}
