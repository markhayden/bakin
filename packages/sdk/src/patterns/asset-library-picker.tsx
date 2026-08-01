'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Button, FileInput, type FileInputHandle } from '@bakin/ui'

import { AssetPicker, type AssetPickerCollection } from './picker-patterns'

/** One asset in the versioned library listing. */
export interface AssetLibraryAsset {
  assetId: string
  description: string
  type: string
  hasThumb: boolean
}

export interface AssetLibraryPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the chosen (or freshly uploaded) assetId; the dialog closes itself after. */
  onPick: (assetId: string) => void
  /** Dialog heading (default "Choose an asset"). */
  title?: string
  /** One-liner under the heading (e.g. what the asset will be used for). */
  description?: string
  /** Narrow the grid (e.g. only images). Applied client-side over the library listing. */
  filter?: (asset: AssetLibraryAsset) => boolean
  /**
   * Library loader override. Defaults to the assets plugin listing
   * (`GET /api/plugins/assets/versioned`).
   */
  loadAssets?: () => Promise<AssetLibraryAsset[]>
  /**
   * Upload override. Defaults to the assets plugin upload endpoint
   * (`POST /api/plugins/assets/upload`).
   */
  uploadAsset?: (file: File) => Promise<{ assetId: string }>
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; assets: AssetLibraryAsset[] }

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

async function defaultLoadAssets(): Promise<AssetLibraryAsset[]> {
  const response = await fetch('/api/plugins/assets/versioned')
  if (!response.ok) throw new Error(`assets listing failed (${response.status})`)
  const body = await response.json() as { assets?: unknown }
  const assets = Array.isArray(body.assets) ? body.assets.filter(assetRecord) : []
  return assets.map((asset) => ({
    assetId: asset.assetId,
    description: asset.description ?? '',
    type: asset.type ?? 'other',
    hasThumb: Boolean(asset.hasThumb),
  }))
}

async function defaultUploadAsset(file: File): Promise<{ assetId: string }> {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch('/api/plugins/assets/upload', { method: 'POST', body: form })
  const body = await response.json().catch(() => ({})) as { assetId?: unknown; error?: unknown }
  if (!response.ok || typeof body.assetId !== 'string') {
    throw new Error(typeof body.error === 'string' ? body.error : 'Upload failed')
  }
  return { assetId: body.assetId }
}

function UploadGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={className ?? 'size-bakin-4'} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 10.5V3M4.75 6.25 8 3l3.25 3.25M2.5 12.5h11" />
    </svg>
  )
}

function SpinnerGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={`animate-spin motion-reduce:animate-none ${className ?? 'size-bakin-4'}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M14 8a6 6 0 1 1-6-6" />
    </svg>
  )
}

/**
 * The library-connected asset chooser: the presentation-only `AssetPicker`
 * composed with the assets plugin's listing + upload wiring (thumbnail grid,
 * search, upload-new, drag-drop) — never a raw id select. `loadAssets` /
 * `uploadAsset` override the endpoints for tests and non-default sources.
 */
export function AssetLibraryPicker({
  open,
  onOpenChange,
  onPick,
  title = 'Choose an asset',
  description,
  filter,
  loadAssets = defaultLoadAssets,
  uploadAsset = defaultUploadAsset,
}: AssetLibraryPickerProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<FileInputHandle>(null)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      setState({ status: 'ready', assets: await loadAssets() })
    } catch {
      setState({ status: 'error' })
    }
  }, [loadAssets])

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
      const { assetId } = await uploadAsset(file)
      pick(assetId)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setUploading(false)
    }
  }, [pick, uploadAsset])

  const dropZoneProps = {
    onDragOver: (event: DragEvent) => {
      event.preventDefault()
      setDragOver(true)
    },
    onDragLeave: (event: DragEvent) => {
      event.preventDefault()
      setDragOver(false)
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      setDragOver(false)
      const image = Array.from(event.dataTransfer?.files ?? []).find((file) => file.type.startsWith('image/'))
      if (image) void upload(image)
      else if ((event.dataTransfer?.files.length ?? 0) > 0) setUploadError('Only images can be uploaded here.')
    },
  }

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
        onClick={() => fileRef.current?.open()}
        data-asset-picker-upload=""
      >
        {uploading ? <SpinnerGlyph /> : <UploadGlyph />}
        {uploading ? 'Uploading…' : 'Upload new'}
      </Button>
      <span className="[font-size:var(--bakin-typography-size-meta)] text-bakin-text-muted">or drag an image here</span>
      <FileInput
        ref={fileRef}
        label="Upload a new asset"
        accept="image/*"
        onFiles={([file]) => {
          if (file) void upload(file)
        }}
      />
    </>
  )

  return (
    <AssetPicker
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
      dropZoneProps={dropZoneProps}
      notice={uploadError}
      busy={uploading}
    />
  )
}
