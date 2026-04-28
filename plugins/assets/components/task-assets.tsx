'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { FolderOpen, Image, Video, Music, FileText, Plus, X } from 'lucide-react'
import { AssetDetailModal } from './asset-detail'
import type { AssetMeta } from "@bakin/sdk/types"

const TYPE_ICONS: Record<string, typeof FileText> = {
  text: FileText,
  images: Image,
  video: Video,
  audio: Music,
}

interface TaskAssetsProps {
  taskId: string
  readOnly?: boolean
}

export function TaskAssets({ taskId, readOnly }: TaskAssetsProps) {
  const [assets, setAssets] = useState<AssetMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [previewFilename, setPreviewFilename] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  const fetchAssets = useCallback(() => {
    fetch(`/api/plugins/assets/?taskId=${encodeURIComponent(taskId)}&includeChildren=true`)
      .then(r => r.ok ? r.json() : { assets: [] })
      .then(d => setAssets(d.assets || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [taskId])

  useEffect(() => {
    fetchAssets()
  }, [fetchAssets])

  // Listen for asset-related events to auto-refresh
  useEffect(() => {
    const es = new EventSource('/api/events')
    esRef.current = es
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        // Refresh on workflow step completions
        if (data.type === 'plugin-event' && data.event === 'workflow.step_complete') {
          if (data.taskId === taskId || data.taskId?.startsWith(taskId + '--')) {
            fetchAssets()
          }
        }
        // Refresh on asset uploads/changes for this task
        if (data.type === 'activity' && data.pluginId === 'assets' && data.taskId === taskId) {
          fetchAssets()
        }
        // Refresh on audit events from asset uploads
        if (data.type === 'audit' && data.event?.startsWith('assets.') && data.taskId === taskId) {
          fetchAssets()
        }
      } catch { /* ignore */ }
    }
    return () => { es.close(); esRef.current = null }
  }, [taskId, fetchAssets])

  // Listen for local asset upload events (e.g. clipboard paste in same dialog)
  // SSE can miss events during React re-renders that recreate the EventSource
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.taskId === taskId) fetchAssets()
    }
    window.addEventListener('bakin:asset-uploaded', handler)
    return () => window.removeEventListener('bakin:asset-uploaded', handler)
  }, [taskId, fetchAssets])

  const handleUnlink = async (filename: string) => {
    try {
      const res = await fetch('/api/plugins/assets/link', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, taskId: null }),
      })
      if (res.ok) fetchAssets()
    } catch { /* ignore */ }
  }

  if (loading) return null

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <FolderOpen className="size-3 text-muted-foreground" />
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Assets {assets.length > 0 && `(${assets.length})`}
        </h3>
        {!readOnly && (
          <Link
            to="/assets"
            search={{ linkTo: taskId }}
            className="ml-auto flex items-center gap-1 text-[11px] font-medium bg-accent text-accent-foreground rounded-md px-2 py-0.5 hover:bg-accent/90 transition-colors"
          >
            <Plus className="size-3" />
            Add
          </Link>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {assets.map(asset => {
          const Icon = TYPE_ICONS[asset.type] || FileText
          return (
            <div
              key={asset.path}
              className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 hover:border-[rgba(255,255,255,0.15)] transition-colors group text-left w-full"
            >
              <button
                onClick={() => setPreviewFilename(asset.filename)}
                className="flex items-center gap-2 flex-1 min-w-0"
              >
                {asset.type === 'images' ? (
                  <img
                    src={`/api/assets/${encodeURIComponent(asset.filename)}`}
                    alt={asset.filename}
                    className="size-8 rounded object-cover shrink-0"
                  />
                ) : (
                  <div className="size-8 rounded bg-muted flex items-center justify-center shrink-0">
                    <Icon className="size-4 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{asset.filename}</p>
                  {asset.metadata.description && (
                    <p className="text-[10px] text-muted-foreground truncate">{asset.metadata.description}</p>
                  )}
                </div>
              </button>
              {!readOnly && (
                <button
                  onClick={() => handleUnlink(asset.filename)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground shrink-0 p-1 transition-opacity"
                  title="Remove from task"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {previewFilename && (
        <AssetDetailModal
          filename={previewFilename}
          onClose={() => setPreviewFilename(null)}
        />
      )}
    </div>
  )
}
