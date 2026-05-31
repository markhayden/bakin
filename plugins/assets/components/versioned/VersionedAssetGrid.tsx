'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryState } from '@makinbakin/sdk/hooks'
import { Badge, Button } from '@makinbakin/sdk/ui'
import { formatSize } from '@makinbakin/sdk/utils'
import { ImagePlus, Upload, Loader2 } from 'lucide-react'
import { AssetThumb, AssetMetaSummary } from './atoms'
import { VERSIONED_API, UPLOAD_API } from './asset-urls'
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
  // When arriving from a task ("Add" on TaskAssets), uploads link to that task.
  const [linkTo] = useQueryState('linkTo', '')
  const [assets, setAssets] = useState<VersionedAssetSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      for (const file of Array.from(files)) form.append('files', file)
      if (linkTo) form.append('taskId', linkTo)
      const res = await fetch(UPLOAD_API, { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || `Upload failed (${res.status})`)
      }
      // Manifest writes drive asset.changed, but refetch immediately so the
      // grid updates even if the SSE round-trip is slow.
      fetchAssets()
      if (linkTo) window.dispatchEvent(new CustomEvent('bakin:asset-uploaded', { detail: { taskId: linkTo } }))
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [linkTo, fetchAssets])

  const openPicker = () => fileInputRef.current?.click()

  // Hidden file input shared by the empty-state CTA and the header "Add" button.
  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      className="hidden"
      aria-label="Upload assets"
      data-testid="asset-upload-input"
      onChange={(e) => handleFiles(e.target.files)}
    />
  )

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading assets…</div>

  if (assets.length === 0) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center p-8 text-center" data-testid="assets-empty">
        {fileInput}
        <div className="flex size-14 items-center justify-center rounded-full bg-accent/40 text-muted-foreground">
          <ImagePlus className="size-7" />
        </div>
        <h2 className="mt-4 text-base font-semibold text-foreground">No assets yet</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {linkTo
            ? 'Upload a file to attach it to this task. Agents also create assets as they work.'
            : 'Upload images, documents, or other files. Agents also create assets here as they work.'}
        </p>
        <Button className="mt-4" onClick={openPicker} disabled={uploading} data-testid="add-first-asset">
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {uploading ? 'Uploading…' : 'Add your first asset'}
        </Button>
        {uploadError && <p className="mt-2 text-xs text-destructive">{uploadError}</p>}
      </div>
    )
  }

  return (
    <div className="p-4">
      {fileInput}
      <div className="mb-3 flex items-center gap-2">
        <h1 className="text-lg font-semibold">Assets</h1>
        <Badge variant="secondary">{assets.length}</Badge>
        <Button size="sm" className="ml-auto" onClick={openPicker} disabled={uploading} data-testid="add-asset">
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {uploading ? 'Uploading…' : 'Add asset'}
        </Button>
      </div>
      {uploadError && <p className="mb-2 text-xs text-destructive">{uploadError}</p>}
      {linkTo && (
        <p className="mb-2 text-xs text-muted-foreground">New uploads will be linked to this task.</p>
      )}
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
