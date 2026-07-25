'use client'

/**
 * Import view (D7): the ONLY surface that turns unmanaged files into
 * assets. Fetches the on-demand scan when opened, lists candidates with a
 * per-row type select (seeded from the scan's suggestion), and offers
 * per-file Import + Import All. Live counts ride the `asset.unmanaged`
 * SSE event the watcher-fed tracker emits.
 */
import { useCallback, useEffect, useState } from 'react'
import { Download, FolderSearch, Loader2 } from 'lucide-react'
import { Button } from '@makinbakin/sdk/ui'
import { usePluginEvent } from '@makinbakin/sdk/hooks'
import { formatAge, formatSize } from '@makinbakin/sdk/utils'
import { AssetTypeIcon } from './atoms'
import { IMPORT_API } from './asset-urls'

const ASSET_TYPES = ['text', 'images', 'video', 'audio', 'plans', 'research', 'pdf', 'data', 'other'] as const

interface UnmanagedFile {
  relPath: string
  name: string
  size: number
  mtimeMs: number
  suggestedType: string
}

export function ImportView({ onImported }: { onImported?: () => void }) {
  const [files, setFiles] = useState<UnmanagedFile[]>([])
  const [typeOverrides, setTypeOverrides] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | 'all' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const scan = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${IMPORT_API}/scan`)
      if (!res.ok) throw new Error(`scan failed (${res.status})`)
      const body = await res.json() as { files: UnmanagedFile[] }
      setFiles(body.files)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void scan() }, [scan])
  // A new drop while the view is open → rescan (debounced server-side).
  usePluginEvent('asset.unmanaged', () => { if (busy === null) void scan() })

  const runImport = async (payload: { paths?: string[]; all?: boolean }, busyKey: string | 'all') => {
    setBusy(busyKey)
    setError(null)
    try {
      const type = payload.paths?.length === 1 ? typeOverrides[payload.paths[0]] : undefined
      const res = await fetch(IMPORT_API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, ...(type ? { type } : {}) }),
      })
      const body = await res.json() as { ok?: boolean; error?: string; failed?: number }
      if (!res.ok || body.error) throw new Error(body.error ?? `import failed (${res.status})`)
      if ((body.failed ?? 0) > 0) setError(`${body.failed} file(s) failed to import`)
      await scan()
      onImported?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  if (loading && files.length === 0) {
    return <div className="p-8 text-sm text-muted-foreground" data-testid="import-loading">Scanning for unmanaged files…</div>
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-10 text-center" data-testid="import-empty">
        <FolderSearch className="size-7 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">No unmanaged files</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Files dropped into <code>~/.bakin/assets/</code> (including <code>assets/inbox/</code>) appear
          here for explicit import — nothing is ever imported automatically.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2" data-testid="import-list">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {files.length} unmanaged file{files.length === 1 ? '' : 's'} — imported assets are indexed and searchable like any other.
        </p>
        <Button size="sm" onClick={() => runImport({ all: true }, 'all')} disabled={busy !== null} data-testid="import-all">
          {busy === 'all' ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          Import all ({files.length})
        </Button>
      </div>
      {error && <p className="text-xs text-destructive" data-testid="import-error">{error}</p>}
      {files.map(file => (
        <div key={file.relPath} className="flex items-center gap-3 rounded-bakin-surface border border-bakin-border-subtle/30 bg-bakin-surface-default px-bakin-3 py-bakin-2" data-testid={`import-row-${file.name}`}>
          <div className="flex size-9 shrink-0 items-center justify-center rounded bg-zinc-900/50">
            <AssetTypeIcon type={typeOverrides[file.relPath] ?? file.suggestedType} className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="truncate">{file.relPath}</span><span>·</span>
              <span>{formatSize(file.size)}</span><span>·</span>
              <span>{formatAge(new Date(file.mtimeMs).toISOString())}</span>
            </div>
          </div>
          <select
            className="h-7 rounded border border-border bg-background px-1 text-xs"
            value={typeOverrides[file.relPath] ?? file.suggestedType}
            onChange={e => setTypeOverrides(prev => ({ ...prev, [file.relPath]: e.target.value }))}
            data-testid={`import-type-${file.name}`}
          >
            {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <Button
            size="sm" variant="outline" className="h-7 text-xs"
            onClick={() => runImport({ paths: [file.relPath] }, file.relPath)}
            disabled={busy !== null}
            data-testid={`import-${file.name}`}
          >
            {busy === file.relPath ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            Import
          </Button>
        </div>
      ))}
    </div>
  )
}
