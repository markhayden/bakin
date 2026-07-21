'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import {
  AssetPicker as AssetPickerPresentation,
  type AssetPickerCollection,
} from '@makinbakin/sdk/patterns'
import { Button } from '@/components/ui/button'
import { useFileDrop } from '@/hooks/use-file-drop'

export interface AssetPickerAsset {
  assetId: string
  description: string
  type: string
  hasThumb: boolean
}

export interface AssetPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the chosen (or freshly uploaded) assetId; the dialog closes itself after. */
  onPick: (assetId: string) => void
  /** Dialog heading (default "Choose an asset"). */
  title?: string
  /** One-liner under the heading (e.g. what the asset will be used for). */
  description?: string
  /** Narrow the grid (e.g. only images). Applied client-side over the library listing. */
  filter?: (asset: AssetPickerAsset) => boolean
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; assets: AssetPickerAsset[] }

function assetRecord(value: unknown): value is {
  assetId: string
  description?: string
  type?: string
  hasThumb?: boolean
} {
  if (!value || typeof value !== 'object') return false
  const asset = value as Record<string, unknown>
  return typeof asset.assetId === 'string'
    && (asset.description == null || typeof asset.description === 'string')
    && (asset.type == null || typeof asset.type === 'string')
    && (asset.hasThumb == null || typeof asset.hasThumb === 'boolean')
}

/** App-aware compatibility adapter for the assets plugin endpoints and upload mechanics. */
export function AssetPicker({
  open,
  onOpenChange,
  onPick,
  title = 'Choose an asset',
  description,
  filter,
}: AssetPickerProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const response = await fetch('/api/plugins/assets/versioned')
      if (!response.ok) throw new Error(`assets listing failed (${response.status})`)
      const body = await response.json() as { assets?: unknown }
      const assets = Array.isArray(body.assets) ? body.assets.filter(assetRecord) : []
      setState({
        status: 'ready',
        assets: assets.map((asset) => ({
          assetId: asset.assetId,
          description: asset.description ?? '',
          type: asset.type ?? 'other',
          hasThumb: Boolean(asset.hasThumb),
        })),
      })
    } catch {
      setState({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setUploadError(null)
    void load()
  }, [open, load])

  const pick = useCallback((assetId: string) => {
    onPick(assetId)
    onOpenChange(false)
  }, [onPick, onOpenChange])

  const upload = useCallback(async (file: File) => {
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch('/api/plugins/assets/upload', { method: 'POST', body: form })
      const body = await response.json().catch(() => ({})) as { assetId?: unknown; error?: unknown }
      if (!response.ok || typeof body.assetId !== 'string') {
        throw new Error(typeof body.error === 'string' ? body.error : 'Upload failed')
      }
      pick(body.assetId)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setUploading(false)
    }
  }, [pick])

  const { dragOver, dropProps } = useFileDrop({
    accept: ['image/'],
    onFiles: ([file]) => void upload(file),
    onRejected: () => setUploadError('Only images can be uploaded here.'),
  })

  const collection = useMemo<AssetPickerCollection>(() => {
    if (state.status === 'loading') return { status: 'loading' }
    if (state.status === 'error') {
      return { status: 'error', message: "The asset library isn't reachable right now. You can still upload a new file." }
    }
    const assets = filter ? state.assets.filter(filter) : state.assets
    return {
      status: 'ready',
      assets: assets.map((asset) => ({
        id: asset.assetId,
        label: asset.description || asset.assetId,
        description: asset.description ? asset.assetId : undefined,
        type: asset.type,
        thumbnailSrc: asset.hasThumb ? `/api/assets/${encodeURIComponent(asset.assetId)}/thumb` : undefined,
      })),
    }
  }, [filter, state])

  const uploadAction = (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        data-asset-picker-upload=""
      >
        {uploading ? <Loader2 aria-hidden="true" className="size-bakin-4 animate-spin motion-reduce:animate-none" /> : <Upload aria-hidden="true" className="size-bakin-4" />}
        {uploading ? 'Uploading…' : 'Upload new'}
      </Button>
      <span className="text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">or drag an image here</span>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
          event.target.value = ''
        }}
      />
    </>
  )

  return (
    <AssetPickerPresentation
      variant="dialog"
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      collection={collection}
      query={query}
      onQueryChange={setQuery}
      onPick={pick}
      onRetry={() => void load()}
      toolbarAction={uploadAction}
      dropActive={dragOver}
      dropZoneProps={dropProps}
      notice={uploadError}
      busy={uploading}
    />
  )
}
