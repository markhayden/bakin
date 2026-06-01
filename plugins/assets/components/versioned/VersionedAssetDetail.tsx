'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from '@tanstack/react-router'
import { Badge, Button } from '@makinbakin/sdk/ui'
import { ArrowLeft, Download, Trash2, Upload, Loader2, X } from 'lucide-react'
import { AssetMetaSummary } from './atoms'
import { AssetPreview } from './AssetPreview'
import { VersionRow } from './VersionRow'
import { assetVersionUrl, assetExportUrl, VERSIONED_API } from './asset-urls'
import type { VersionedAssetManifest } from './types'

export function VersionedAssetDetail() {
  const { assetId } = useParams({ strict: false }) as { assetId: string }
  const navigate = useNavigate()
  const [manifest, setManifest] = useState<VersionedAssetManifest | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteScope, setDeleteScope] = useState<'asset' | 'current'>('asset')
  const [addingVersion, setAddingVersion] = useState(false)
  const [versionError, setVersionError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const versionInputRef = useRef<HTMLInputElement | null>(null)

  const fetchManifest = useCallback(() => {
    fetch(`${VERSIONED_API}/${encodeURIComponent(assetId)}`)
      .then(r => r.ok ? r.json() : { asset: null })
      .then(d => setManifest(d.asset))
      .catch(() => setManifest(null))
      .finally(() => setLoading(false))
  }, [assetId])

  useEffect(() => { fetchManifest() }, [fetchManifest])

  useEffect(() => {
    const es = new EventSource('/api/events')
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'plugin-event' && data.assetId === assetId) {
          if (data.event === 'asset.removed') navigate({ to: '/assets' })
          else if (data.event === 'asset.changed') fetchManifest()
        }
      } catch { /* ignore */ }
    }
    return () => es.close()
  }, [assetId, fetchManifest, navigate])

  const promote = (version: number) => fetch(`${VERSIONED_API}/${encodeURIComponent(assetId)}/promote`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }),
  }).then(fetchManifest)

  const deleteVersion = (version: number) => fetch(`${VERSIONED_API}/${encodeURIComponent(assetId)}/v/${version}`, {
    method: 'DELETE',
  }).then(fetchManifest)

  const addVersion = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setAddingVersion(true)
    setVersionError(null)
    try {
      const form = new FormData()
      form.append('file', files[0])
      const res = await fetch(`${VERSIONED_API}/${encodeURIComponent(assetId)}/version`, { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || `Upload failed (${res.status})`)
      }
      fetchManifest()
    } catch (err) {
      setVersionError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setAddingVersion(false)
      if (versionInputRef.current) versionInputRef.current.value = ''
    }
  }, [assetId, fetchManifest])

  const doDelete = async () => {
    if (deleteScope === 'current' && manifest) {
      await deleteVersion(manifest.currentVersion)
      setConfirmDelete(false)
    } else {
      await fetch(`${VERSIONED_API}/${encodeURIComponent(assetId)}`, { method: 'DELETE' })
      navigate({ to: '/assets' })
    }
  }

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>
  if (!manifest) return (
    <div className="p-8 text-sm text-muted-foreground" data-testid="asset-not-found">
      Asset not found. <Link to="/assets" className="text-blue-400">Back to assets</Link>
    </div>
  )

  // Current pinned to the top, then the rest newest-first.
  const versions = [...manifest.versions].sort((a, b) => {
    if (a.version === manifest.currentVersion) return -1
    if (b.version === manifest.currentVersion) return 1
    return b.version - a.version
  })
  // Preview the selected version when it still exists, else the current one.
  const previewVersion = (selectedVersion != null && manifest.versions.some(v => v.version === selectedVersion))
    ? selectedVersion
    : manifest.currentVersion
  const previewVer = manifest.versions.find(v => v.version === previewVersion) ?? manifest.versions[manifest.versions.length - 1]
  const isImage = manifest.type === 'images'

  return (
    <div className="w-full p-4" data-testid="asset-detail">
      <input
        ref={versionInputRef}
        type="file"
        className="hidden"
        aria-label="Add version"
        data-testid="add-version-input"
        onChange={(e) => addVersion(e.target.files)}
      />
      <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-4 flex items-center gap-2 border-b border-border bg-background px-4 py-3">
        <Button size="sm" variant="ghost" onClick={() => navigate({ to: '/assets' })}><ArrowLeft className="size-4 mr-1" /> Assets</Button>
        <h1 className="truncate text-base font-semibold" title={manifest.assetId}>{manifest.description || manifest.assetId}</h1>
        <Badge variant="secondary" className="ml-auto" data-testid="version-count">{manifest.versions.length} version{manifest.versions.length === 1 ? '' : 's'}</Badge>
        <Button size="sm" variant="outline" onClick={() => versionInputRef.current?.click()} disabled={addingVersion} data-testid="add-version">
          {addingVersion ? <Loader2 className="size-4 animate-spin mr-1" /> : <Upload className="size-4 mr-1" />}
          {addingVersion ? 'Uploading…' : 'Add version'}
        </Button>
        <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => { setDeleteScope('asset'); setConfirmDelete(true) }} data-testid="delete-asset">
          <Trash2 className="size-4" />
        </Button>
      </div>
      {versionError && <p className="mb-2 text-xs text-destructive">{versionError}</p>}

      {/* Current version preview — inline render by type, with editor for text. */}
      <div className="mb-4" data-testid="current-preview">
        <AssetPreview
          assetId={manifest.assetId}
          type={manifest.type}
          mimeType={previewVer.mimeType}
          version={previewVersion}
          currentFile={previewVer.file}
          onImageClick={() => setLightbox(true)}
          onSaved={fetchManifest}
        />
      </div>

      <div className="mb-4"><AssetMetaSummary agent={manifest.agent} created={manifest.created} taskId={manifest.taskId} tags={manifest.tags} /></div>

      {/* Exports */}
      {manifest.exports.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">Exports</h2>
          <div className="flex flex-wrap gap-2" data-testid="exports">
            {manifest.exports.map(exp => (
              <a key={exp.name} href={assetExportUrl(manifest.assetId, exp.name)} download
                 className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-blue-400 hover:bg-white/5">
                <Download className="size-3" /> {exp.name}.{exp.format} <span className="text-muted-foreground">(from v{exp.fromVersion})</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Version timeline */}
      <h2 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">History</h2>
      <div className="flex flex-col gap-2" data-testid="version-timeline">
        {versions.map(v => (
          <VersionRow
            key={v.version}
            assetId={manifest.assetId}
            assetType={manifest.type}
            version={v}
            isCurrent={v.version === manifest.currentVersion}
            isSelected={v.version === previewVersion}
            canDelete={manifest.versions.length > 1}
            onSelect={setSelectedVersion}
            onPromote={promote}
            onDelete={deleteVersion}
          />
        ))}
      </div>

      {/* Fullscreen image lightbox */}
      {lightbox && isImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6"
          onClick={() => setLightbox(false)}
          data-testid="lightbox"
        >
          <button
            className="absolute right-4 top-4 text-zinc-300 hover:text-white"
            onClick={() => setLightbox(false)}
            aria-label="Close"
          >
            <X className="size-6" />
          </button>
          <img
            src={assetVersionUrl(manifest.assetId, previewVersion)}
            alt={manifest.assetId}
            className="max-h-[92vh] max-w-[92vw] rounded object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Delete-scope dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" data-testid="delete-dialog">
          <div className="w-80 rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">Delete asset</h3>
            {manifest.versions.length > 1 ? (
              <div className="mb-3 flex flex-col gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="scope" checked={deleteScope === 'asset'} onChange={() => setDeleteScope('asset')} data-testid="scope-asset" />
                  Delete whole asset (all {manifest.versions.length} versions)
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="scope" checked={deleteScope === 'current'} onChange={() => setDeleteScope('current')} data-testid="scope-current" />
                  Just delete the current version (v{manifest.currentVersion})
                </label>
              </div>
            ) : (
              <p className="mb-3 text-sm text-muted-foreground">Delete this asset?</p>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button size="sm" variant="destructive" onClick={doDelete} data-testid="confirm-delete">Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
