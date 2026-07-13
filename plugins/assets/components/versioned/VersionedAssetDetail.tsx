'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from '@tanstack/react-router'
import { usePluginEvent, useHistoryBack } from '@makinbakin/sdk/hooks'
import { ConfirmDialog } from '@makinbakin/sdk/components'
import { Badge, Button } from '@makinbakin/sdk/ui'
import { ArrowLeft, Download, Pencil, Trash2, Upload, Loader2, X } from 'lucide-react'
import { AssetMetaSummary, AssetThumb } from './atoms'
import { AssetEditDrawer } from './AssetEditDrawer'
import { EnrichmentCard } from './EnrichmentCard'
import { AssetPreview } from './AssetPreview'
import { VersionRow } from './VersionRow'
import { assetVersionUrl, assetExportUrl, VERSIONED_API } from './asset-urls'
import type { VersionedAssetManifest } from './types'

export function VersionedAssetDetail() {
  const { assetId } = useParams({ strict: false }) as { assetId: string }
  const navigate = useNavigate()
  // Reached from many places (brand assets tab, search, tasks) — back means
  // "where I came from", not the assets home.
  const goBack = useHistoryBack('/assets')
  const [manifest, setManifest] = useState<VersionedAssetManifest | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteScope, setDeleteScope] = useState<'asset' | 'current'>('asset')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [addingVersion, setAddingVersion] = useState(false)
  const [versionError, setVersionError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
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

  usePluginEvent('asset.removed', (d) => { if (d.assetId === assetId) navigate({ to: '/assets' }) })
  usePluginEvent('asset.changed', (d) => { if (d.assetId === assetId) fetchManifest() })

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
    setDeleting(true)
    setDeleteError(null)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 10000)
    try {
      if (deleteScope === 'current' && manifest) {
        const res = await fetch(`${VERSIONED_API}/${encodeURIComponent(assetId)}/v/${manifest.currentVersion}`, {
          method: 'DELETE',
          signal: controller.signal,
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string }
          throw new Error(body.error || `Delete failed (${res.status})`)
        }
        fetchManifest()
        setConfirmDelete(false)
      } else {
        const res = await fetch(`${VERSIONED_API}/${encodeURIComponent(assetId)}`, {
          method: 'DELETE',
          signal: controller.signal,
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string }
          throw new Error(body.error || `Delete failed (${res.status})`)
        }
        navigate({ to: '/assets' })
      }
    } catch (err) {
      const message = err instanceof DOMException && err.name === 'AbortError'
        ? 'Delete timed out. Check the server log and try again.'
        : err instanceof Error
          ? err.message
          : 'Delete failed.'
      setDeleteError(message)
    } finally {
      window.clearTimeout(timeout)
      setDeleting(false)
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
        <Button size="sm" variant="ghost" onClick={goBack}><ArrowLeft className="size-4 mr-1" /> Back</Button>
        <h1 className="truncate text-base font-semibold" title={manifest.assetId}>{manifest.description || manifest.assetId}</h1>
        <Badge variant="secondary" className="ml-auto" data-testid="version-count">{manifest.versions.length} version{manifest.versions.length === 1 ? '' : 's'}</Badge>
        <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} data-testid="edit-asset">
          <Pencil className="size-4 mr-1" /> Edit
        </Button>
        <Button size="sm" variant="outline" onClick={() => versionInputRef.current?.click()} disabled={addingVersion} data-testid="add-version">
          {addingVersion ? <Loader2 className="size-4 animate-spin mr-1" /> : <Upload className="size-4 mr-1" />}
          {addingVersion ? 'Uploading…' : 'Add version'}
        </Button>
        <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => { setDeleteScope('asset'); setDeleteError(null); setConfirmDelete(true) }} data-testid="delete-asset">
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

      <div className="mb-4"><AssetMetaSummary agent={manifest.agent} created={manifest.created} taskId={manifest.taskId} tags={manifest.tags} maxTags={Infinity} /></div>

      <AssetEditDrawer
        assetId={manifest.assetId}
        initialDescription={manifest.description}
        initialTags={manifest.tags ?? []}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={fetchManifest}
      />

      {/* Derived metadata — what the vision model saw (D8) */}
      <EnrichmentCard manifest={manifest} onChanged={fetchManifest} />

      {/* References — assets that conditioned this generation (#418) */}
      {previewVer.generation?.references && previewVer.generation.references.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">References</h2>
          <div className="flex flex-wrap gap-2" data-testid="references">
            {previewVer.generation.references.map(ref => (
              <Link
                key={`${ref.assetId}@${ref.version}`}
                to="/assets/$assetId"
                params={{ assetId: ref.assetId }}
                className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs hover:bg-white/5"
              >
                <span className="size-8 shrink-0 overflow-hidden rounded">
                  <AssetThumb assetId={ref.assetId} type="images" version={ref.version} className="h-full w-full object-cover" />
                </span>
                <span className="text-muted-foreground">{ref.assetId} <span className="opacity-60">v{ref.version}</span></span>
              </Link>
            ))}
          </div>
        </div>
      )}

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
      <ConfirmDialog
        open={confirmDelete}
        title="Delete asset"
        description={manifest.versions.length > 1 ? (
          // DialogDescription renders a <p>, so the radio group stays phrasing
          // content: <span>/<label>/<input> only, no block elements.
          <span className="flex flex-col gap-2 text-sm text-foreground" data-testid="delete-dialog">
            <label className="flex items-center gap-2">
              <input type="radio" name="scope" checked={deleteScope === 'asset'} onChange={() => setDeleteScope('asset')} data-testid="scope-asset" />
              Delete whole asset (all {manifest.versions.length} versions)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="scope" checked={deleteScope === 'current'} onChange={() => setDeleteScope('current')} data-testid="scope-current" />
              Just delete the current version (v{manifest.currentVersion})
            </label>
          </span>
        ) : 'Delete this asset?'}
        busy={deleting}
        busyLabel="Deleting..."
        error={deleteError}
        cancelVariant="ghost"
        confirmTestId="confirm-delete"
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
