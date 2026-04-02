'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { AssetMeta, TrashedAssetMeta } from '@/types'

interface UseAssetsOptions {
  type?: string
  agent?: string
  taskId?: string
  tag?: string
  limit?: number
  offset?: number
}

export function useAssets(options: UseAssetsOptions = {}) {
  const [assets, setAssets] = useState<AssetMeta[]>([])
  const [total, setTotal] = useState(0)
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
    if (opts.limit) params.set('limit', String(opts.limit))
    if (opts.offset) params.set('offset', String(opts.offset))

    try {
      const res = await fetch(`/api/plugins/assets/?${params}`)
      if (res.ok) {
        const data = await res.json()
        setAssets(data.assets || [])
        setTotal(data.total ?? data.count ?? 0)
      }
    } catch {
      // Network error — keep existing state
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAssets()
  }, [fetchAssets, options.type, options.agent, options.taskId, options.tag, options.limit, options.offset])

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

  return { assets, total, loading, refresh: fetchAssets, deleteAsset }
}

export function useTrash() {
  const [items, setItems] = useState<TrashedAssetMeta[]>([])
  const [loading, setLoading] = useState(true)

  const fetchTrash = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/assets/trash')
      if (res.ok) {
        const data = await res.json()
        setItems(data.assets || [])
      }
    } catch {
      // Network error — keep existing state
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTrash()
  }, [fetchTrash])

  // Listen for SSE trash events
  useEffect(() => {
    const es = new EventSource('/api/events')
    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        if (data.file?.includes('.trash/') || data.event?.startsWith('asset.')) {
          fetchTrash()
        }
      } catch { /* ignore */ }
    }
    es.addEventListener('message', handler)
    return () => {
      es.removeEventListener('message', handler)
      es.close()
    }
  }, [fetchTrash])

  const restoreAsset = useCallback(async (filename: string) => {
    try {
      const res = await fetch(`/api/plugins/assets/restore?file=${encodeURIComponent(filename)}`, {
        method: 'POST',
      })
      if (res.ok) {
        setItems(prev => prev.filter(i => i.filename !== filename))
        return true
      }
    } catch { /* ignore */ }
    return false
  }, [])

  const permanentDeleteAsset = useCallback(async (filename: string) => {
    try {
      const res = await fetch(`/api/plugins/assets/permanent-delete?file=${encodeURIComponent(filename)}`, {
        method: 'POST',
      })
      if (res.ok) {
        setItems(prev => prev.filter(i => i.filename !== filename))
        return true
      }
    } catch { /* ignore */ }
    return false
  }, [])

  const emptyTrash = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/assets/empty-trash', { method: 'POST' })
      if (res.ok) {
        setItems([])
        return true
      }
    } catch { /* ignore */ }
    return false
  }, [])

  return { items, loading, refresh: fetchTrash, restoreAsset, permanentDeleteAsset, emptyTrash }
}
