'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImageIcon, Loader2, Upload } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { cn } from '@/lib/utils'

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

/**
 * Modal asset chooser over the assets plugin's library: search, thumbnail
 * grid, and drag/drop or button upload-new (which picks the fresh asset).
 * THE way any surface references a managed asset — never a raw id `<select>`.
 * Engine-unreachable renders an honest error state, never a blank grid.
 */
export function AssetPicker({ open, onOpenChange, onPick, title = 'Choose an asset', description, filter }: AssetPickerProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const res = await fetch('/api/plugins/assets/versioned')
      if (!res.ok) throw new Error(`assets listing failed (${res.status})`)
      const body = (await res.json()) as {
        assets?: Array<{ assetId: string; description?: string; type?: string; hasThumb?: boolean }>
      }
      setState({
        status: 'ready',
        assets: (body.assets ?? []).map((a) => ({
          assetId: a.assetId,
          description: a.description ?? '',
          type: a.type ?? 'other',
          hasThumb: !!a.hasThumb,
        })),
      })
    } catch {
      setState({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setUploadError(null)
      void load()
    }
  }, [open, load])

  const pick = useCallback(
    (assetId: string) => {
      onPick(assetId)
      onOpenChange(false)
    },
    [onPick, onOpenChange],
  )

  const upload = useCallback(
    async (file: File) => {
      setUploading(true)
      setUploadError(null)
      try {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch('/api/plugins/assets/upload', { method: 'POST', body: form })
        const body = (await res.json().catch(() => ({}))) as { assetId?: string; error?: string }
        if (!res.ok || !body.assetId) throw new Error(body.error ?? 'Upload failed')
        pick(body.assetId)
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : String(err))
      } finally {
        setUploading(false)
      }
    },
    [pick],
  )

  const visible = useMemo(() => {
    if (state.status !== 'ready') return []
    const base = filter ? state.assets.filter(filter) : state.assets
    const q = query.trim().toLowerCase()
    if (!q) return base
    return base.filter((a) => a.description.toLowerCase().includes(q) || a.assetId.toLowerCase().includes(q))
  }, [state, filter, query])

  return (
    <Dialog open={open} onOpenChange={(next) => !uploading && onOpenChange(next)}>
      <DialogContent className="bg-card border-border sm:max-w-2xl" data-asset-picker>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div
          className={cn(
            'flex items-center gap-2 rounded-lg p-1.5 transition-colors',
            dragOver ? 'ring-2 ring-foreground/25' : 'ring-1 ring-inset ring-foreground/10',
          )}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const f = e.dataTransfer.files?.[0]
            if (!f) return
            // Match the browse input's accept="image/*" — a dropped file
            // shouldn't sneak past the same restriction.
            if (!f.type.startsWith('image/')) {
              setUploadError('Only images can be uploaded here.')
              return
            }
            void upload(f)
          }}
        >
          <Button variant="secondary" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()} data-asset-picker-upload>
            {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {uploading ? 'Uploading...' : 'Upload new'}
          </Button>
          <span className="text-xs text-muted-foreground">or drag a file here</span>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your assets..."
            className="ml-auto h-8 max-w-56"
            data-asset-picker-search
          />
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void upload(f)
            e.target.value = ''
          }}
        />
        {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}

        <div className="max-h-96 overflow-y-auto" data-asset-picker-grid>
          {state.status === 'loading' && (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {Array.from({ length: 10 }, (_, i) => (
                <Skeleton key={i} className="aspect-square rounded-lg" />
              ))}
            </div>
          )}
          {state.status === 'error' && (
            <ErrorState
              title="Couldn't load your assets"
              message="The asset library isn't reachable right now. You can still upload a new file above."
              retry={() => void load()}
            />
          )}
          {state.status === 'ready' && visible.length === 0 && (
            <EmptyState
              icon={ImageIcon}
              title={query ? 'No assets match your search' : 'No assets yet'}
              description={query ? 'Try a different word, or upload a new file above.' : 'Upload a file above to get started.'}
            />
          )}
          {state.status === 'ready' && visible.length > 0 && (
            <ul className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {visible.map((a) => (
                <li key={a.assetId}>
                  <button
                    className="group flex w-full flex-col gap-1 rounded-lg p-1 text-left transition-colors hover:bg-foreground/5"
                    onClick={() => pick(a.assetId)}
                    data-asset-picker-item={a.assetId}
                  >
                    <span className="block aspect-square w-full overflow-hidden rounded-lg bg-background/50 ring-1 ring-foreground/10 transition-shadow group-hover:ring-foreground/25">
                      {a.hasThumb ? (
                        <img src={`/api/assets/${a.assetId}/thumb`} alt="" className="size-full object-cover" loading="lazy" />
                      ) : (
                        <span className="flex size-full items-center justify-center text-muted-foreground">
                          <ImageIcon className="size-5" />
                        </span>
                      )}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground">{a.description || a.assetId}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
