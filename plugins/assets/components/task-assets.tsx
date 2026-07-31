'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePluginEvent } from '@makinbakin/sdk/hooks'
import { Button, DrawerSection } from '@makinbakin/sdk/ui'
import { ListRow, ListRows } from '@makinbakin/sdk/patterns'
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
            className="ml-auto flex items-center gap-1 rounded-bakin-control bg-bakin-action-primary-background px-2 py-0.5 text-bakin-typography-size-meta font-bakin-typography-weight-medium text-bakin-action-primary-foreground transition-colors hover:brightness-110 motion-reduce:transition-none"
          >
            <Plus className="size-3" />
            Add
          </Link>
      ) : undefined}
    >
      <ListRows variant="bordered" aria-label="Task assets" className="gap-bakin-1">
        {assets.map(asset => (
          <ListRow
            key={asset.assetId}
            className="group flex w-full items-center gap-2 px-bakin-3 py-bakin-2 text-left transition-colors hover:border-bakin-border-subtle/80 motion-reduce:transition-none"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => navigate({ to: '/assets/$assetId', params: { assetId: asset.assetId } })}
              className="!h-auto min-w-0 flex-1 justify-start gap-2 whitespace-normal p-0 text-left font-bakin-typography-weight-regular hover:bg-transparent"
            >
              <span className="size-8 shrink-0 overflow-hidden rounded">
                <AssetThumb assetId={asset.assetId} type={asset.type} version={asset.currentVersion} hasThumb={asset.hasThumb} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-bakin-text-primary">{asset.description || asset.assetId}</span>
                {asset.versionCount > 1 && (
                  <span className="block text-bakin-typography-size-meta text-bakin-action-primary-background">v{asset.currentVersion} · {asset.versionCount} versions</span>
                )}
              </span>
            </Button>
            {!readOnly && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => handleUnlink(asset.assetId)}
                className="shrink-0 text-bakin-text-muted opacity-0 transition-opacity hover:text-bakin-text-primary group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
                title="Remove from task"
                aria-label={`Remove ${asset.description || asset.assetId} from task`}
              >
                <X className="size-3.5" />
              </Button>
            )}
          </ListRow>
        ))}
      </ListRows>
    </DrawerSection>
  )
}
