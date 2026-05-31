'use client'

import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Badge } from '@makinbakin/sdk/ui'
import { formatSize } from '@makinbakin/sdk/utils'
import { AssetThumb, AssetMetaSummary } from './atoms'
import { VERSIONED_API } from './asset-urls'
import type { VersionedAssetSummary } from './types'

function AssetCard({ asset, onOpen }: { asset: VersionedAssetSummary; onOpen: () => void }) {
  return (
    <div
      onClick={onOpen}
      className="flex cursor-pointer flex-col overflow-hidden rounded-lg border border-border bg-card transition-all duration-150 hover:-translate-y-0.5 hover:border-[rgba(255,255,255,0.15)]"
      data-testid={`asset-card-${asset.assetId}`}
    >
      <div className="relative h-32 overflow-hidden bg-zinc-900/50">
        <AssetThumb assetId={asset.assetId} type={asset.type} hasThumb={asset.hasThumb} />
        {asset.versionCount > 1 && (
          <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300" data-testid="version-badge">
            v{asset.currentVersion} · {asset.versionCount} versions
          </span>
        )}
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-zinc-400">
          {formatSize(asset.size)}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <span className="truncate text-sm font-medium text-foreground" title={asset.assetId}>
          {asset.description || asset.assetId}
        </span>
        <AssetMetaSummary agent={asset.agent} created={asset.created} taskId={asset.taskId} tags={asset.tags} />
      </div>
    </div>
  )
}

export function VersionedAssetGrid() {
  const navigate = useNavigate()
  const [assets, setAssets] = useState<VersionedAssetSummary[]>([])
  const [loading, setLoading] = useState(true)

  const fetchAssets = useCallback(() => {
    fetch(VERSIONED_API)
      .then(r => r.ok ? r.json() : { assets: [] })
      .then(d => setAssets(d.assets || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchAssets() }, [fetchAssets])

  // Live refresh: any asset mutation rewrites a manifest → asset.changed/removed.
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'plugin-event' && (data.event === 'asset.changed' || data.event === 'asset.removed')) {
          fetchAssets()
        }
      } catch { /* ignore non-JSON */ }
    }
    return () => es.close()
  }, [fetchAssets])

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading assets…</div>
  if (assets.length === 0) return <div className="p-8 text-sm text-muted-foreground" data-testid="assets-empty">No assets yet.</div>

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <h1 className="text-lg font-semibold">Assets</h1>
        <Badge variant="secondary">{assets.length}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" data-testid="assets-grid">
        {assets.map(asset => (
          <AssetCard
            key={asset.assetId}
            asset={asset}
            onOpen={() => navigate({ to: '/assets/$assetId', params: { assetId: asset.assetId } })}
          />
        ))}
      </div>
    </div>
  )
}
