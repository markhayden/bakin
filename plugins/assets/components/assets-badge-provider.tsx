'use client'

import { useEffect, useRef, useState } from 'react'
import { useNavBadge, usePluginEvent, usePluginJsonFetch } from '@makinbakin/sdk/hooks'

/** Snapshot on mount/recovery; events invalidate it rather than racing a cached count. */
export function AssetsBadgeProvider() {
  const { data, loading, error, refresh } = usePluginJsonFetch<{ count: number }>('assets', 'import/summary', { timeoutMs: 15_000 })
  const [count, setCount] = useState<number | null>(null)
  const attempts = useRef(0)
  const valid = data !== null && Number.isSafeInteger(data.count) && data.count >= 0
  usePluginEvent('asset.unmanaged', refresh)
  usePluginEvent('bakin.reconcile', refresh)

  useEffect(() => {
    if (loading) return
    if (valid && !error) setCount(data.count)
    if (!error && (data === null || valid)) { attempts.current = 0; return }
    const retry = setTimeout(refresh, Math.min(1000 * 2 ** attempts.current++, 30_000))
    return () => clearTimeout(retry)
  }, [data, loading, error, valid, refresh])

  useNavBadge('assets', 'assets', count !== null && count > 0 ? { count, tone: 'info' } : null)
  return null
}
