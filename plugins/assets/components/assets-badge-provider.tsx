'use client'

import { useState } from 'react'
import type { NavBadge } from '@makinbakin/sdk'
import { useNavBadge, usePluginEvent } from '@makinbakin/sdk/hooks'

/**
 * Background component (renders nothing) mounted via the host's
 * `nav-badge-providers` slot. Shows an info count on the Assets nav item
 * when unmanaged files await explicit import (D7). Driven purely by the
 * `asset.unmanaged` SSE event the watcher-fed tracker emits — no fetch on
 * mount: the count is honestly 0 until something is KNOWN (the tracker
 * starts empty at boot; opening the Import view or a doctor sweep reseeds
 * it from a real scan).
 */
export function AssetsBadgeProvider() {
  const [count, setCount] = useState(0)

  usePluginEvent('asset.unmanaged', (d) => {
    setCount(typeof d.count === 'number' ? d.count : 0)
  })

  const badge: NavBadge | null = count > 0 ? { count, tone: 'info' } : null
  useNavBadge('assets', 'assets', badge)

  return null
}
