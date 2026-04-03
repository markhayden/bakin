'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { FolderOpen, Image, Video, Music, FileText, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { AssetDetailModal } from './asset-detail'
import type { AssetMeta } from '@/types'

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
  const [previewPath, setPreviewPath] = useState<string | null>(null)
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

  // Listen for workflow step completions to auto-refresh assets
  useEffect(() => {
    const es = new EventSource('/api/events')
    esRef.current = es
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'plugin-event' && data.event === 'workflow.step_complete') {
          if (data.taskId === taskId || data.taskId?.startsWith(taskId + '--')) {
            fetchAssets()
          }
        }
      } catch { /* ignore */ }
    }
    return () => { es.close(); esRef.current = null }
  }, [taskId, fetchAssets])

  if (loading) return null

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <FolderOpen className="size-3 text-muted-foreground" />
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Assets {assets.length > 0 && `(${assets.length})`}
        </h3>
        {!readOnly && (
          <a
            href={`/assets?linkTo=${encodeURIComponent(taskId)}`}
            className="ml-auto flex items-center gap-1 text-[11px] font-medium bg-accent text-accent-foreground rounded-md px-2 py-0.5 hover:bg-accent/90 transition-colors"
          >
            <Plus className="size-3" />
            Add
          </a>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {assets.map(asset => {
          const Icon = TYPE_ICONS[asset.type] || FileText
          return (
            <button
              key={asset.path}
              onClick={() => setPreviewPath(asset.path)}
              className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 hover:border-[rgba(255,255,255,0.15)] transition-colors group text-left w-full"
            >
              {asset.type === 'images' ? (
                <img
                  src={`/api/plugins/assets/file?path=${encodeURIComponent(asset.path)}`}
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
          )
        })}
      </div>

      {previewPath && (
        <AssetDetailModal
          assetPath={previewPath}
          onClose={() => setPreviewPath(null)}
        />
      )}
    </div>
  )
}
