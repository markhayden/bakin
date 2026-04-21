'use client'

import { useEffect, useState } from 'react'
import type { NotificationChannelDef } from '../lib/notification-channel-registry'

/**
 * Module-level cache + single-flight promise. Two components mounting in
 * the same paint share one network round-trip. Settings/registry edits
 * require a page reload for v1 (see #124 for the live-refresh follow-up).
 */
let cached: NotificationChannelDef[] | null = null
let inFlight: Promise<NotificationChannelDef[]> | null = null

function fetchChannels(): Promise<NotificationChannelDef[]> {
  if (cached) return Promise.resolve(cached)
  if (inFlight) return inFlight
  inFlight = fetch('/api/plugins/workflows/notification-channels')
    .then((r) => (r.ok ? r.json() : null))
    .then((data: { channels?: NotificationChannelDef[] } | null) => {
      const list = data && Array.isArray(data.channels) ? data.channels : []
      cached = list
      return list
    })
    .catch(() => {
      cached = []
      return [] as NotificationChannelDef[]
    })
    .finally(() => { inFlight = null })
  return inFlight
}

export function useNotificationChannels(): NotificationChannelDef[] {
  const [channels, setChannels] = useState<NotificationChannelDef[]>(() => cached ?? [])

  useEffect(() => {
    if (cached) return
    let cancelled = false
    fetchChannels().then((list) => {
      if (!cancelled) setChannels(list)
    })
    return () => { cancelled = true }
  }, [])

  return channels
}

export function getChannelLabel(id: string, channels: NotificationChannelDef[]): string {
  return channels.find((c) => c.id === id)?.label ?? id
}

export function getChannelInitials(id: string, channels: NotificationChannelDef[]): string {
  const match = channels.find((c) => c.id === id)
  if (match?.initials) return match.initials
  return id.slice(0, 2).toUpperCase()
}

/** Test-only: reset the module-level cache so tests run with a clean slate. */
export function __resetNotificationChannelsCache(): void {
  if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) return
  cached = null
  inFlight = null
}
