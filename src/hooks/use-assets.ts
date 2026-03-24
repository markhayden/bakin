'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { AssetMeta } from '@/types'

interface UseAssetsOptions {
  type?: string
  agent?: string
  taskId?: string
  tag?: string
}

export function useAssets(options: UseAssetsOptions = {}) {
  const [assets, setAssets] = useState<AssetMeta[]>([])
  const [loading, setLoading] = useState(true)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const fetchAssets = useCallback(async () => {
    const params = new URLSearchParams()
    const opts = optionsRef.current
    if (opts.type && opts.type !== 'all') params.set('type', opts.type)
    if (opts.agent) params.set('agent', opts.agent)
    if (opts.taskId) params.set('taskId', opts.taskId)
    if (opts.tag) params.set('tag', opts.tag)

    try {
      const res = await fetch(`/api/plugins/assets/list?${params}`)
      if (res.ok) {
        const data = await res.json()
        setAssets(data.assets || [])
      }
    } catch {
      // Network error — keep existing state
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAssets()
  }, [fetchAssets, options.type, options.agent, options.taskId, options.tag])

  // Listen for SSE asset events
  useEffect(() => {
    const es = new EventSource('/api/events')
    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        if (data.file?.startsWith('assets/') || data.event?.startsWith('asset.')) {
          // Refresh asset list on any asset change
          fetchAssets()
        }
      } catch { /* ignore parse errors */ }
    }
    es.addEventListener('message', handler)
    return () => {
      es.removeEventListener('message', handler)
      es.close()
    }
  }, [fetchAssets])

  const deleteAsset = useCallback(async (path: string) => {
    try {
      const res = await fetch(`/api/plugins/assets/delete?path=${encodeURIComponent(path)}`, {
        method: 'POST',
      })
      if (res.ok) {
        setAssets(prev => prev.filter(a => a.path !== path))
        return true
      }
    } catch { /* ignore */ }
    return false
  }, [])

  return { assets, loading, refresh: fetchAssets, deleteAsset }
}
