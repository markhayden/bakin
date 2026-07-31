'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  PluginLink,
  useHistoryBack,
  useParams,
  useRouter,
} from '@makinbakin/sdk/navigation'
import { usePluginEvent } from '@makinbakin/sdk/hooks'
import {
  ConfirmDialog,
  Page,
  PageAside,
  PageBody,
  PageHeader,
} from '@makinbakin/sdk/patterns'
import { Section, Stack } from '@makinbakin/sdk/layout'
import {
  Badge,
  Banner,
  Button,
  DropdownMenuItem,
  SystemState,
} from '@makinbakin/sdk/ui'
import { ArrowLeft, Download, Pencil, Trash2, Upload, Loader2, X } from 'lucide-react'
import { AssetMetaSummary, AssetThumb } from './atoms'
import { AssetEditDrawer } from './AssetEditDrawer'
import { EnrichmentCard } from './EnrichmentCard'
import { AssetPreview } from './AssetPreview'
import { VersionRow } from './VersionRow'
import { assetVersionUrl, assetExportUrl, VERSIONED_API } from './asset-urls'
import type { VersionedAssetManifest } from './types'

export function VersionedAssetDetail() {
  const { assetId } = useParams<{ assetId: string }>()
  const router = useRouter()
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

  usePluginEvent('asset.removed', (d) => { if (d.assetId === assetId) router.push('/assets') })
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
        router.push('/assets')
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

  if (loading) {
    return (
      <Page data-testid="asset-detail">
        <PageHeader
          navigation={(
            <Button
              size="icon-sm"
              variant="ghost"
              className="rounded-bakin-pill"
              onClick={goBack}
              aria-label="Back to assets"
              title="Back to assets"
            >
              <ArrowLeft />
            </Button>
          )}
          eyebrow="Assets / detail"
          title="Asset detail"
          description={assetId}
        />
        <PageBody
          state={(
            <SystemState
              kind="loading"
              title="Loading asset"
              description="The preview, metadata, and version history will appear here."
            />
          )}
        />
      </Page>
    )
  }

  if (!manifest) {
    return (
      <Page data-testid="asset-not-found">
        <PageHeader
          navigation={(
            <Button
              size="icon-sm"
              variant="ghost"
              className="rounded-bakin-pill"
              onClick={goBack}
              aria-label="Back to assets"
              title="Back to assets"
            >
              <ArrowLeft />
            </Button>
          )}
          eyebrow="Assets / detail"
          title="Asset detail"
          description={assetId}
        />
        <PageBody
          state={(
            <SystemState
              kind="error"
              title="Asset not found"
              description="This asset may have been removed or is no longer available."
              action={<Button variant="outline" onClick={() => router.push('/assets')}>Open assets</Button>}
            />
          )}
        />
      </Page>
    )
  }

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
    <Page data-testid="asset-detail">
      <input
        ref={versionInputRef}
        type="file"
        className="hidden"
        aria-label="Add version"
        data-testid="add-version-input"
        onChange={(e) => addVersion(e.target.files)}
      />

      <PageHeader
        measure="wide"
        navigation={(
          <Button
            size="icon-sm"
            variant="ghost"
            className="rounded-bakin-pill"
            onClick={goBack}
            aria-label="Back to assets"
            title="Back to assets"
          >
            <ArrowLeft />
          </Button>
        )}
        eyebrow="Assets / detail"
        title={manifest.description || manifest.assetId}
        meta={(
          <>
            <code className="break-all font-bakin-typography-family-mono">{manifest.assetId}</code>
            <Badge tone="neutral" variant="soft">{manifest.type}</Badge>
            <Badge tone="neutral" variant="soft" data-testid="version-count">
              {manifest.versions.length} version{manifest.versions.length === 1 ? '' : 's'}
            </Badge>
          </>
        )}
        actionsLabel="Asset actions"
        actions={(
          <Button variant="primary" onClick={() => setEditOpen(true)} data-testid="edit-asset">
            <Pencil /> Edit asset
          </Button>
        )}
        overflowActionsLabel="Asset actions"
        overflowActions={(
          <>
            <DropdownMenuItem
              onClick={() => versionInputRef.current?.click()}
              disabled={addingVersion}
              data-testid="add-version"
            >
              {addingVersion ? <Loader2 className="animate-spin" /> : <Upload />}
              {addingVersion ? 'Uploading…' : 'Add version'}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="danger"
              onClick={() => {
                setDeleteScope('asset')
                setDeleteError(null)
                setConfirmDelete(true)
              }}
              data-testid="delete-asset"
            >
              <Trash2 /> Delete
            </DropdownMenuItem>
          </>
        )}
      />

      <PageBody
        layout="aside"
        feedback={versionError ? (
          <Banner
            tone="danger"
            title="Version upload failed"
            description={versionError}
          />
        ) : undefined}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-bakin-6">
          <Section spacing="compact" aria-labelledby="asset-preview-heading">
            <Stack gap="dense">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-2">
                <h2
                  id="asset-preview-heading"
                  className="m-0 text-bakin-typography-size-section-title font-bakin-typography-weight-semibold text-bakin-text-primary"
                >
                  Preview
                </h2>
                <Badge tone={previewVersion === manifest.currentVersion ? 'success' : 'accent'} variant="soft">
                  v{previewVersion}{previewVersion === manifest.currentVersion ? ' · current' : ' · selected'}
                </Badge>
              </div>
            </Stack>
            <div data-testid="current-preview">
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
          </Section>

        </div>

        <PageAside label="Asset context">
          <section className="flex min-w-0 flex-col gap-bakin-3" aria-labelledby="asset-context-heading">
            <h2
              id="asset-context-heading"
              className="m-0 text-bakin-typography-size-section-title font-bakin-typography-weight-semibold text-bakin-text-primary"
            >
              Asset context
            </h2>
            <AssetMetaSummary
              agent={manifest.agent}
              created={manifest.created}
              taskId={manifest.taskId}
              tags={manifest.tags}
              maxTags={Infinity}
            />
            <dl className="grid min-w-0 gap-bakin-2 text-bakin-typography-size-meta">
              <div className="flex min-w-0 items-baseline justify-between gap-bakin-3 border-t border-bakin-border-subtle pt-bakin-2">
                <dt className="text-bakin-text-muted">Source</dt>
                <dd className="m-0 min-w-0 break-words text-right text-bakin-text-primary">{manifest.source.kind}</dd>
              </div>
              <div className="flex min-w-0 items-baseline justify-between gap-bakin-3 border-t border-bakin-border-subtle pt-bakin-2">
                <dt className="text-bakin-text-muted">Current version</dt>
                <dd className="m-0 font-bakin-typography-family-mono text-bakin-text-primary">v{manifest.currentVersion}</dd>
              </div>
            </dl>

            <EnrichmentCard manifest={manifest} onChanged={fetchManifest} />
          </section>

          {previewVer.generation?.references && previewVer.generation.references.length > 0 ? (
            <section className="flex min-w-0 flex-col gap-bakin-3 border-t border-bakin-border-subtle pt-bakin-4" aria-labelledby="asset-references-heading">
              <h2
                id="asset-references-heading"
                className="m-0 text-bakin-typography-size-section-title font-bakin-typography-weight-semibold text-bakin-text-primary"
              >
                References
              </h2>
              <div className="flex min-w-0 flex-col gap-bakin-2" data-testid="references">
                {previewVer.generation.references.map(ref => (
                  <PluginLink
                    key={`${ref.assetId}@${ref.version}`}
                    to={`/assets/${encodeURIComponent(ref.assetId)}`}
                    className="flex min-w-0 items-center gap-bakin-2 rounded-bakin-control px-bakin-2 py-bakin-1 text-bakin-typography-size-meta text-bakin-text-primary hover:bg-bakin-surface-default"
                  >
                    <span className="size-bakin-8 shrink-0 overflow-hidden rounded-bakin-control">
                      <AssetThumb assetId={ref.assetId} type="images" version={ref.version} className="h-full w-full object-cover" />
                    </span>
                    <span className="min-w-0 break-all">
                      {ref.assetId} <span className="text-bakin-text-muted">v{ref.version}</span>
                    </span>
                  </PluginLink>
                ))}
              </div>
            </section>
          ) : null}

          {manifest.exports.length > 0 ? (
            <section className="flex min-w-0 flex-col gap-bakin-3 border-t border-bakin-border-subtle pt-bakin-4" aria-labelledby="asset-downloads-heading">
              <h2
                id="asset-downloads-heading"
                className="m-0 text-bakin-typography-size-section-title font-bakin-typography-weight-semibold text-bakin-text-primary"
              >
                Downloads
              </h2>
              <div className="flex min-w-0 flex-col gap-bakin-2" data-testid="exports">
                {manifest.exports.map(exp => (
                  <a
                    key={exp.name}
                    href={assetExportUrl(manifest.assetId, exp.name)}
                    download
                    className="flex min-w-0 items-center gap-bakin-2 rounded-bakin-control px-bakin-2 py-bakin-2 text-bakin-typography-size-meta text-bakin-text-primary hover:bg-bakin-surface-default"
                  >
                    <Download className="size-bakin-3 shrink-0 text-bakin-signal-accent" />
                    <span className="min-w-0 break-all">{exp.name}.{exp.format}</span>
                    <span className="ml-auto shrink-0 text-bakin-text-muted">v{exp.fromVersion}</span>
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          <Section spacing="compact" divider="top" aria-labelledby="asset-history-heading">
            <Stack gap="dense">
              <h2
                id="asset-history-heading"
                className="m-0 text-bakin-typography-size-section-title font-bakin-typography-weight-semibold text-bakin-text-primary"
              >
                Version history
              </h2>
              <p className="m-0 text-bakin-typography-size-body leading-relaxed text-bakin-text-muted">
                Select a version to preview it. Promoting a version does not remove newer history.
              </p>
            </Stack>
            <div className="flex flex-col gap-bakin-2" data-testid="version-timeline">
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
          </Section>
        </PageAside>
      </PageBody>

      <AssetEditDrawer
        assetId={manifest.assetId}
        initialDescription={manifest.description}
        initialTags={manifest.tags ?? []}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={fetchManifest}
      />

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
    </Page>
  )
}
