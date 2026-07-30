'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePluginEvent } from '@makinbakin/sdk/hooks'
import { DrawerSection } from '@makinbakin/sdk/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { FolderOpen, Plus, X } from 'lucide-react'
import { AssetThumb } from './versioned/atoms'
import { VERSIONED_API } from './versioned/asset-urls'
import type { VersionedAssetSummary } from './versioned/types'

interface TaskAssetsProps {
  taskId: string
  readOnly?: boolean
}

export function TaskAssets({ taskId, readOnly }: TaskAssetsProps) {
  const navigate = useNavigate()
  const [assets, setAssets] = useState<VersionedAssetSummary[]>([])
  const [loading, setLoading] = useState(true)

  const fetchAssets = useCallback(() => {
    fetch(`${VERSIONED_API}?taskId=${encodeURIComponent(taskId)}&includeChildren=true`)
      .then(r => r.ok ? r.json() : { assets: [] })
      .then(d => setAssets(d.assets || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [taskId])

  useEffect(() => { fetchAssets() }, [fetchAssets])

  // Auto-refresh on asset + workflow events for this task (over the shell's
  // single SSE connection).
  usePluginEvent('asset.changed', fetchAssets)
  usePluginEvent('asset.removed', fetchAssets)
  usePluginEvent('workflow.step_complete', (d) => {
    const t = d.taskId as string | undefined
    if (t === taskId || t?.startsWith(taskId + '--')) fetchAssets()
  })

  // Local upload events (e.g. clipboard paste in the same dialog).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.taskId === taskId) fetchAssets()
    }
    window.addEventListener('bakin:asset-uploaded', handler)
    return () => window.removeEventListener('bakin:asset-uploaded', handler)
  }, [taskId, fetchAssets])

  const handleUnlink = async (assetId: string) => {
    try {
      const res = await fetch(`${VERSIONED_API}/${encodeURIComponent(assetId)}/relink`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: null }),
      })
      if (res.ok) fetchAssets()
    } catch { /* ignore */ }
  }

  if (loading) return null

  return (
    <DrawerSection
      title={(
        <span className="inline-flex items-center gap-bakin-1">
          <FolderOpen className="size-bakin-3" aria-hidden="true" />
          Assets {assets.length > 0 && `(${assets.length})`}
        </span>
      )}
      actions={!readOnly ? (
          <Link
            to="/assets"
            search={{ linkTo: taskId }}
            className="ml-auto flex items-center gap-1 text-[11px] font-medium bg-accent text-accent-foreground rounded-md px-2 py-0.5 hover:bg-accent/90 transition-colors"
          >
            <Plus className="size-3" />
            Add
          </Link>
      ) : undefined}
    >
      <div className="flex flex-col gap-1.5">
        {assets.map(asset => (
          <div
            key={asset.assetId}
            className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 hover:border-[rgba(255,255,255,0.15)] transition-colors group text-left w-full"
          >
            <button
              onClick={() => navigate({ to: '/assets/$assetId', params: { assetId: asset.assetId } })}
              className="flex items-center gap-2 flex-1 min-w-0"
            >
              <div className="size-8 shrink-0 overflow-hidden rounded">
                <AssetThumb assetId={asset.assetId} type={asset.type} version={asset.currentVersion} hasThumb={asset.hasThumb} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{asset.description || asset.assetId}</p>
                {asset.versionCount > 1 && (
                  <p className="text-[10px] text-emerald-400">v{asset.currentVersion} · {asset.versionCount} versions</p>
                )}
              </div>
            </button>
            {!readOnly && (
              <button
                onClick={() => handleUnlink(asset.assetId)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground shrink-0 p-1 transition-opacity"
                title="Remove from task"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </DrawerSection>
  )
}
