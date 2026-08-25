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
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SystemState } from '@makinbakin/sdk/ui'
import { DataTable, type DataTableColumn } from '@makinbakin/sdk/patterns'
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

export function ImportView({ onImported, onCountChange }: { onImported?: () => void; onCountChange?: (count: number) => void }) {
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
  // The page header's "N shown" badge stays consistent across tabs.
  useEffect(() => { onCountChange?.(files.length) }, [files.length, onCountChange])
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
    return (
      <SystemState
        kind="loading"
        scope="section"
        title="Scanning for unmanaged files"
        data-testid="import-loading"
      />
    )
  }

  if (files.length === 0) {
    return (
      <SystemState
        kind="initial-empty"
        scope="section"
        icon={<FolderSearch className="size-bakin-6 text-bakin-text-muted" />}
        title="No unmanaged files"
        description={(
          <>
            Files dropped into <code>~/.bakin/assets/</code> (including <code>assets/inbox/</code>) appear
            here for explicit import — nothing is ever imported automatically.
          </>
        )}
        data-testid="import-empty"
      />
    )
  }

  const columns = makeColumns()

  return (
    <div className="flex flex-col gap-bakin-2" data-testid="import-list">
      <div className="mb-bakin-1 flex items-center justify-between">
        <p className="text-bakin-typography-size-meta text-bakin-text-muted">
          {files.length} unmanaged file{files.length === 1 ? '' : 's'} — imported assets are indexed and searchable like any other.
        </p>
        <Button size="sm" onClick={() => runImport({ all: true }, 'all')} disabled={busy !== null} data-testid="import-all">
          {busy === 'all' ? <Loader2 className="size-bakin-3 animate-spin" /> : <Download className="size-bakin-3" />}
          Import all ({files.length})
        </Button>
      </div>
      {error && <p className="text-bakin-typography-size-meta text-bakin-signal-danger" data-testid="import-error">{error}</p>}
      <DataTable
        label="Unmanaged files"
        columns={columns}
        rows={files}
        rowKey={file => file.relPath}
        rowProps={file => ({ 'data-testid': `import-row-${file.name}` })}
        tableProps={{ className: 'min-w-max' }}
      />
    </div>
  )

  function makeColumns(): ReadonlyArray<DataTableColumn<UnmanagedFile>> {
    return [
      {
        key: 'file',
        header: 'File',
        narrow: 'primary',
        headClassName: 'min-w-64',
        cell: file => (
          <div className="flex min-w-0 items-center gap-bakin-3">
            <div className="flex size-bakin-8 shrink-0 items-center justify-center rounded-bakin-control bg-bakin-canvas-default">
              <AssetTypeIcon type={typeOverrides[file.relPath] ?? file.suggestedType} className="size-bakin-4" />
            </div>
            <div className="min-w-0">
              <p className="m-0 truncate text-bakin-typography-size-body font-bakin-typography-weight-medium text-bakin-text-primary">{file.name}</p>
              <p className="m-0 truncate text-bakin-typography-size-meta text-bakin-text-muted">{file.relPath}</p>
            </div>
          </div>
        ),
      },
      {
        key: 'size',
        header: 'Size',
        narrow: 'meta',
        cell: file => <span className="text-bakin-text-muted">{formatSize(file.size)}</span>,
      },
      {
        key: 'age',
        header: 'Age',
        narrow: 'meta',
        cell: file => <span className="text-bakin-text-muted">{formatAge(new Date(file.mtimeMs).toISOString())}</span>,
      },
      {
        key: 'type',
        header: 'Import as',
        cell: file => (
          <Select
            value={typeOverrides[file.relPath] ?? file.suggestedType}
            onValueChange={(next) => { if (next) setTypeOverrides(prev => ({ ...prev, [file.relPath]: next })) }}
          >
            <SelectTrigger
              size="sm"
              aria-label={`Asset type for ${file.name}`}
              className="w-auto"
              data-testid={`import-type-${file.name}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSET_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        ),
      },
      {
        key: 'action',
        header: 'Import',
        hideLabel: true,
        align: 'end',
        cell: file => (
          <Button
            size="xs" variant="outline"
            onClick={() => runImport({ paths: [file.relPath] }, file.relPath)}
            disabled={busy !== null}
            data-testid={`import-${file.name}`}
          >
            {busy === file.relPath ? <Loader2 className="size-bakin-3 animate-spin" /> : <Download className="size-bakin-3" />}
            Import
          </Button>
        ),
      },
    ]
  }
}
