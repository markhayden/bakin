'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useSearch, useDebug, usePluginEvent } from '@makinbakin/sdk/hooks'
import {
  usePathname,
  useQueryArrayState,
  useQueryState,
  useRouter,
  useSearchParams,
} from '@makinbakin/sdk/navigation'
import { Grid } from '@makinbakin/sdk/layout'
import {
  FacetFilter,
  DataTable,
  Page,
  PageBody,
  PageControls,
  PageHeader,
  ScoreOverlay,
  SearchInput,
  SearchUnavailable,
  SegmentedControl,
} from '@makinbakin/sdk/patterns'
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardMedia,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  FileInput,
  SystemState,
  type FileInputHandle,
} from '@makinbakin/sdk/ui'
import { formatSize, formatAge } from '@makinbakin/sdk/utils'
import { Upload, Loader2, LayoutGrid, List, Trash2, RotateCcw, X, ListFilter, FolderOpen, Pencil, Tags, ArrowLeft, Inbox, Sparkles } from 'lucide-react'
import { ASSET_TYPES } from '../../lib/constants'
import { createSseRefetchScheduler } from './sse-refetch'
import { AssetEditDrawer } from './AssetEditDrawer'
import { TagFolderGrid } from './TagFolderGrid'
import { TagInput } from './TagInput'
import { UNTAGGED, matchesTagFilter } from './tag-filter'
import { AssetThumb, AssetMetaSummary, AssetTypeIcon } from './atoms'
import { VERSIONED_API, UPLOAD_API, TRASH_API, TAGS_API, ENRICH_API } from './asset-urls'
import { ImportView } from './ImportView'
import type { VersionedAssetSummary, TrashedAssetSummary } from './types'

type View = 'grid' | 'list' | 'tags' | 'import' | 'trash'

const VIEW_OPTIONS: Array<{ key: View; label: string; Icon: typeof LayoutGrid }> = [
  { key: 'grid', label: 'Grid', Icon: LayoutGrid },
  { key: 'list', label: 'List', Icon: List },
  { key: 'tags', label: 'Folders', Icon: FolderOpen },
  { key: 'import', label: 'Import', Icon: Inbox },
  { key: 'trash', label: 'Trash', Icon: Trash2 },
]

// Type facet — derived from the canonical ASSET_TYPES taxonomy; icons reuse
// AssetTypeIcon so the facet and thumbnails never diverge.
const TYPE_OPTIONS = ASSET_TYPES.map((value) => ({
  value,
  label: value === 'pdf' ? 'PDF' : value.charAt(0).toUpperCase() + value.slice(1),
  icon: <AssetTypeIcon type={value} className="size-bakin-3" />,
}))


/** Per-result Antfly relevance breakdown (shape shared with the SDK ScoreOverlay). */
export interface AssetScoreInfo { score: number; indexScores?: Record<string, number> }

const ENRICHMENT_BADGE: Record<VersionedAssetSummary['enrichment'], { className: string; label: string }> = {
  done: { className: 'text-bakin-action-primary-background', label: 'Enriched — searchable by derived caption/tags' },
  stale: { className: 'text-bakin-signal-highlight', label: 'Enriched for an older version — re-enrich to refresh' },
  pending: { className: 'text-bakin-signal-accent animate-pulse motion-reduce:animate-none', label: 'Enrichment in progress' },
  failed: { className: 'text-bakin-signal-danger', label: 'Enrichment failed — see asset detail' },
  skipped: { className: 'text-bakin-text-muted', label: 'Enrichment skipped (unsupported or no engine)' },
  none: { className: 'text-bakin-text-muted/60', label: 'Not enriched yet — select and hit Enrich' },
}

function EnrichmentDot({ status }: { status: VersionedAssetSummary['enrichment'] }) {
  const badge = ENRICHMENT_BADGE[status] ?? ENRICHMENT_BADGE.none
  return (
    <span data-testid={`enrichment-dot-${status}`} className="flex items-center">
      <Sparkles aria-hidden="true" className={`size-bakin-3 ${badge.className}`} />
      <span className="sr-only">{badge.label}</span>
    </span>
  )
}

function AssetCard({ asset, onOpen, onEdit, selected, onToggleSelect, scoreInfo }: { asset: VersionedAssetSummary; onOpen: () => void; onEdit: () => void; selected: boolean; onToggleSelect: () => void; scoreInfo?: AssetScoreInfo }) {
  const label = asset.description || asset.assetId

  return (
    <Card
      size="sm"
      selected={selected}
      interactive={{ label: `Open ${label}`, onActivate: onOpen }}
      className="h-full gap-0 pb-0"
      data-testid={`asset-card-${asset.assetId}`}
    >
      <CardMedia className="aspect-square bg-bakin-canvas-default">
        <AssetThumb assetId={asset.assetId} type={asset.type} version={asset.currentVersion} hasThumb={asset.hasThumb} />
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelect}
          className="absolute left-bakin-2 top-bakin-2 z-20 bg-bakin-canvas-default/85"
          aria-label={`${selected ? 'Deselect' : 'Select'} ${label}`}
          data-testid={`asset-selected-${asset.assetId}`}
        />
        <Button
          type="button"
          variant="secondary"
          size="icon-xs"
          onClick={onEdit}
          className="absolute right-bakin-2 top-bakin-2 z-20 opacity-100 md:opacity-0 md:group-hover/card:opacity-100 md:focus-visible:opacity-100"
          aria-label={`Edit ${label}`}
          data-testid={`asset-edit-${asset.assetId}`}
        >
          <Pencil />
        </Button>
        {scoreInfo && <ScoreOverlay info={scoreInfo} className="absolute left-1.5 top-1.5 z-10" />}
        {asset.versionCount > 1 && (
          <span className="absolute bottom-bakin-2 left-bakin-2 rounded-bakin-control bg-bakin-canvas-default/85 px-bakin-2 py-bakin-1 text-bakin-typography-size-meta font-bakin-typography-weight-semibold text-bakin-action-primary-background" data-testid="version-badge">
            {asset.versionCount} versions
          </span>
        )}
        <span className="absolute bottom-bakin-2 right-bakin-2 flex items-center gap-bakin-1 rounded-bakin-control bg-bakin-canvas-default/85 px-bakin-2 py-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">
          <EnrichmentDot status={asset.enrichment} />
          {formatSize(asset.size)}
        </span>
      </CardMedia>
      <CardHeader className="gap-bakin-2 py-bakin-3">
        <CardTitle>
          <span className="block truncate">{label}</span>
        </CardTitle>
        <CardDescription>
          <AssetMetaSummary agent={asset.agent} created={asset.created} taskId={asset.taskId} tags={asset.tags} />
        </CardDescription>
      </CardHeader>
    </Card>
  )
}


export function VersionedAssetGrid() {
  const [debug] = useDebug()
  const [linkTo] = useQueryState('linkTo', '')
  const [q, setQ] = useQueryState('q', '')
  const [view, setView] = useQueryState('view', 'grid')
  const [typeFilter, setTypeFilter] = useQueryArrayState('type')
  const [tagFilter, setTagFilter] = useQueryArrayState('tags')

  // Folder navigation updates view AND tags in ONE pushed history entry so
  // folder → filtered-grid → back works like real folders. (useQueryState
  // setters batch per tick since PR3, so clobbering is no longer the reason
  // this exists — the push-with-multiple-params semantics are.)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const pushParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') params.delete(key)
      else params.set(key, val)
    }
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, pathname, searchParams])
  // view=grid is the URL default — omit the param entirely when navigating to it.
  const openFolder = useCallback((tag: string) => pushParams({ view: null, tags: tag }), [pushParams])
  const goToFolders = useCallback(() => pushParams({ view: 'tags', tags: null }), [pushParams])

  const [assets, setAssets] = useState<VersionedAssetSummary[]>([])
  const [trash, setTrash] = useState<TrashedAssetSummary[]>([])
  const [editing, setEditing] = useState<VersionedAssetSummary | null>(null)

  // Bulk selection — checkboxes are always visible; selecting anything
  // raises the floating bulk bar. Ephemeral (not URL-backed), clears on
  // view change.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkTags, setBulkTags] = useState<string[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const clearSelection = useCallback(() => {
    setSelected(new Set())
    setBulkTags([])
    setBulkError(null)
  }, [])
  const [enriching, setEnriching] = useState(false)
  // Non-null while the re-enrich confirmation is open: how many of the
  // selected assets are already enriched for their current version.
  const [confirmEnrich, setConfirmEnrich] = useState<{ done: number; total: number } | null>(null)
  const bulkEnrich = async (force: boolean) => {
    if (selected.size === 0) return
    setConfirmEnrich(null)
    setEnriching(true)
    setBulkError(null)
    try {
      const res = await fetch(ENRICH_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetIds: [...selected], force }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string; engine?: string; agent?: string; count?: number }
      if (!res.ok) throw new Error(body.error || `Enrichment failed (${res.status})`)
      clearSelection()
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : String(err))
    } finally {
      setEnriching(false)
    }
  }
  // One Enrich button: confirmation only when the selection contains assets
  // that are already enriched for their current version (re-running those
  // re-bills; everything else — none/stale/failed/skipped — runs free of that
  // concern under force:false).
  const startEnrich = () => {
    if (selected.size === 0) return
    const done = [...selected].filter((id) => assets.find((a) => a.assetId === id)?.enrichment === 'done').length
    if (done === 0) { void bulkEnrich(false); return }
    setConfirmEnrich({ done, total: selected.size })
  }
  useEffect(() => { clearSelection() }, [view, clearSelection])
  const toggleSelected = (assetId: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(assetId)) next.delete(assetId)
    else next.add(assetId)
    return next
  })
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<FileInputHandle | null>(null)

  // Antfly-backed search (semantic + visual). No client-side fallback: the
  // engine being down is an explicit unavailable state (spec D11), rendered
  // below — never a silently-worse substring substitute.
  const search = useSearch({
    plugin: 'assets',
    facets: ['asset_type', 'agent'],
  })

  const fetchAssets = useCallback(() => {
    fetch(VERSIONED_API)
      .then(r => r.ok ? r.json() : { assets: [] })
      .then(d => setAssets(d.assets || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const fetchTrash = useCallback(() => {
    fetch(TRASH_API)
      .then(r => r.ok ? r.json() : { items: [] })
      .then(d => setTrash(d.items || []))
      .catch(() => {})
  }, [])

  useEffect(() => { fetchAssets() }, [fetchAssets])
  // Trash only needs refetching when entering the tab (it also changes on the
  // explicit restore/empty/permanent-delete actions, which refetch directly).
  useEffect(() => { if (view === 'trash') fetchTrash() }, [view, fetchTrash])

  // Drive the search hook from the URL query. The folders view repurposes the
  // same box as a client-side folder-name filter — no Antfly round-trip.
  // The hook debounces internally (250ms), so this fires per keystroke safely.
  useEffect(() => {
    if (view === 'tags') return
    search.search(q)
  }, [q, view]) // eslint-disable-line react-hooks/exhaustive-deps

  // Coalesce event bursts (agent edit loops) into one refetch per window —
  // direct user actions (upload/restore/trash ops) keep their immediate
  // fetches elsewhere in this component.
  const refetchRef = useRef<ReturnType<typeof createSseRefetchScheduler> | null>(null)
  useEffect(() => {
    refetchRef.current = createSseRefetchScheduler(fetchAssets, fetchTrash)
    return () => { refetchRef.current?.cancel(); refetchRef.current = null }
  }, [fetchAssets, fetchTrash])
  usePluginEvent('asset.changed', () => refetchRef.current?.schedule(false))
  usePluginEvent('asset.removed', () => refetchRef.current?.schedule(true))

  // ─── Upload ──────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      for (const file of files) form.append('files', file)
      if (linkTo) form.append('taskId', linkTo)
      const res = await fetch(UPLOAD_API, { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || `Upload failed (${res.status})`)
      }
      fetchAssets()
      if (linkTo) window.dispatchEvent(new CustomEvent('bakin:asset-uploaded', { detail: { taskId: linkTo } }))
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [linkTo, fetchAssets])

  const openPicker = () => fileInputRef.current?.open()

  // ─── Trash actions ───────────────────────────────────────────────────
  const restore = async (trashName: string) => {
    const res = await fetch(`${TRASH_API}/${encodeURIComponent(trashName)}/restore`, { method: 'POST' })
    if (res.ok) { fetchTrash(); fetchAssets() }
  }
  const permanentDelete = async (trashName: string) => {
    const res = await fetch(`${TRASH_API}/${encodeURIComponent(trashName)}`, { method: 'DELETE' })
    if (res.ok) fetchTrash()
  }
  const emptyTrash = async () => {
    const res = await fetch(TRASH_API, { method: 'DELETE' })
    if (res.ok) fetchTrash()
  }

  // ─── Derived: counts + filtered/ordered list ─────────────────────────
  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const a of assets) c[a.type] = (c[a.type] ?? 0) + 1
    return c
  }, [assets])

  // Tag facet options derive from the loaded summaries (no extra endpoint);
  // the pinned Untagged sentinel keeps tagless assets reachable.
  const tagCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const a of assets) {
      if ((a.tags ?? []).length === 0) c[UNTAGGED] = (c[UNTAGGED] ?? 0) + 1
      for (const t of a.tags ?? []) c[t] = (c[t] ?? 0) + 1
    }
    return c
  }, [assets])

  const tagOptions = useMemo(() => {
    const tags = Object.keys(tagCounts).filter(t => t !== UNTAGGED)
      .sort((a, b) => (tagCounts[b] ?? 0) - (tagCounts[a] ?? 0) || a.localeCompare(b))
      .map(value => ({ value, label: value }))
    return (tagCounts[UNTAGGED] ?? 0) > 0 ? [{ value: UNTAGGED, label: 'Untagged' }, ...tags] : tags
  }, [tagCounts])

  // Folder-name filter for the folders view (header search box, client-side).
  const folderFilter = view === 'tags' ? q.trim().toLowerCase() : ''
  const folderCount = useMemo(
    () => tagOptions.filter(o => !folderFilter || o.label.toLowerCase().includes(folderFilter)).length,
    [tagOptions, folderFilter],
  )

  const scoreMap = useMemo(
    () => new Map<string, AssetScoreInfo>(search.results.map(r => [r.id, { score: r.score, indexScores: r.indexScores }])),
    [search.results],
  )
  const scoreFor = (assetId: string): AssetScoreInfo | undefined => (debug && q.trim() ? scoreMap.get(assetId) : undefined)

  // A search is "pending" while the request is in flight OR the last completed
  // search query doesn't yet match the current input (covers the debounce gap).
  // Used to show a spinner and suppress the "no match" flash before results land.
  // Folders view never searches (folder-name filter is client-side) — without
  // the view guard the stale meta.query would pin the spinner on forever.
  const searching = q.trim().length > 0 && view !== 'tags'
  const searchUnavailable = searching && search.status === 'unavailable'
  const pending = searching && !searchUnavailable && (search.loading || (search.meta?.query ?? '') !== q.trim())

  const filtered = useMemo(() => {
    let list = assets.filter(a =>
      (typeFilter.length === 0 || typeFilter.includes(a.type)) &&
      matchesTagFilter(a.tags ?? [], tagFilter),
    )
    if (q.trim()) {
      // Restrict to search matches, ordered by relevance (reuse scoreMap).
      list = list
        .filter(a => scoreMap.has(a.assetId))
        .sort((a, b) => (scoreMap.get(b.assetId)?.score ?? 0) - (scoreMap.get(a.assetId)?.score ?? 0))
    }
    return list
  }, [assets, typeFilter, tagFilter, q, scoreMap])

  // Keep the last settled list on screen while a search is pending — the
  // results only change once the request completes (no flicker / takeover).
  const displayedRef = useRef<VersionedAssetSummary[]>([])
  if (!pending) displayedRef.current = filtered
  const displayed = pending ? displayedRef.current : filtered

  // Import-tab count for the header badge (ImportView owns the scan).
  const [importCount, setImportCount] = useState<number | null>(null)

  // List-view sort — the consumer owns ordering (DataTable contract).
  const [listSort, setListSort] = useState<{ field: 'name' | 'size' | 'created'; dir: 'asc' | 'desc' }>({ field: 'created', dir: 'desc' })
  const sortedList = useMemo(() => {
    const rows = [...displayed]
    const { field, dir } = listSort
    rows.sort((a, b) => {
      const key = (asset: VersionedAssetSummary): string | number =>
        field === 'name' ? (asset.description || asset.assetId).toLowerCase()
        : field === 'size' ? asset.size
        : new Date(asset.created).getTime()
      const av = key(a)
      const bv = key(b)
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return dir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [displayed, listSort])

  const fileInput = (
    <FileInput
      ref={fileInputRef}
      multiple
      label="Upload assets"
      onFiles={(files) => void handleFiles(files)}
    />
  )

  const viewOptions = VIEW_OPTIONS.map(({ key, label, Icon }) => ({
    value: key,
    label,
    icon: Icon,
  }))

  const applyBulkTags = async () => {
    if (bulkTags.length === 0 || selected.size === 0) return
    setBulkBusy(true)
    setBulkError(null)
    try {
      const res = await fetch(`${TAGS_API}/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetIds: [...selected], add: bulkTags }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || `Tagging failed (${res.status})`)
      }
      clearSelection()
      fetchAssets()
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Tagging failed')
    } finally {
      setBulkBusy(false)
    }
  }

  const collectionState = loading ? (
    <div data-testid="assets-loading">
      <SystemState
        kind="loading"
        title="Loading assets"
        description="Your asset library will appear here when it is ready."
      />
    </div>
  ) : assets.length === 0 && view !== 'trash' ? (
    <div data-testid="assets-empty">
      <SystemState
        kind="initial-empty"
        title="No assets yet"
        description={linkTo
          ? 'Upload a file to attach it to this task. Agents also create assets as they work.'
          : 'Upload images, documents, or other files. Agents also create assets here as they work.'}
        action={(
          <Button onClick={openPicker} disabled={uploading} data-testid="add-first-asset">
            {uploading ? <Loader2 className="size-bakin-4 animate-spin" /> : <Upload className="size-bakin-4" />}
            {uploading ? 'Uploading…' : 'Add your first asset'}
          </Button>
        )}
      />
    </div>
  ) : undefined

  return (
    <Page data-testid="assets-browser">
      {fileInput}
      <PageHeader
        title="Assets"
        description="Keep images, documents, and other deliverables searchable, versioned, and ready to reuse."
        // Every tab carries the count so the header never bounces.
        meta={loading || (view === 'import' && importCount === null) ? undefined : (
          <Badge size="xs" variant="outline">
            {view === 'trash' ? trash.length : view === 'tags' ? folderCount : view === 'import' ? importCount : displayed.length} shown
          </Badge>
        )}
        controlsLabel="Asset search"
        controls={view !== 'trash' && view !== 'import' ? (
          <SearchInput
            align="end"
            label={view === 'tags' ? 'Folder search' : 'Asset search'}
            value={q}
            onValueChange={setQ}
            placeholder={view === 'tags' ? 'Filter folders…' : 'Search assets…'}
            busy={pending}
            mobileFullWidth
          />
        ) : undefined}
        actionsLabel="Asset actions"
        actions={(
          <Button className="min-w-28" onClick={openPicker} disabled={uploading} data-testid="add-asset">
            {uploading ? <Loader2 className="size-bakin-4 animate-spin" /> : <Upload className="size-bakin-4" />}
            {uploading ? 'Uploading…' : 'Add asset'}
          </Button>
        )}
      />


      <PageControls label="Asset views and filters" data-testid="asset-filters">
        <SegmentedControl
          ariaLabel="Asset view"
          options={viewOptions}
          value={view as View}
          onValueChange={setView}
          size="md"
          className="max-w-full"
        />
        {view !== 'trash' && view !== 'tags' ? (
          <>
          <ListFilter className="size-bakin-3 shrink-0 text-bakin-text-muted" />
          <FacetFilter label="Type" options={TYPE_OPTIONS} selected={typeFilter} onChange={setTypeFilter} counts={typeCounts} />
          <FacetFilter label="Tags" options={tagOptions} selected={tagFilter} onChange={setTagFilter} counts={tagCounts} />
          </>
        ) : null}
      </PageControls>

      <PageBody
        label="Asset results"
        busy={!loading && pending}
        state={collectionState}
        feedback={uploadError || (linkTo && view !== 'trash') ? (
          <div className="grid min-w-0 gap-bakin-2">
            {uploadError ? <p className="m-0 text-bakin-typography-size-meta text-bakin-signal-danger">{uploadError}</p> : null}
            {linkTo && view !== 'trash' ? <p className="m-0 text-bakin-typography-size-meta text-bakin-text-muted">New uploads will be linked to this task.</p> : null}
          </div>
        ) : undefined}
      >
      {/* Breadcrumb back to the folders view while a tag filter is active.
          Clearing the filter happens via the Tags facet; the breadcrumb is
          purely a "go back" affordance. */}
      {view !== 'trash' && view !== 'tags' && tagFilter.length > 0 && (
        <div className="mb-bakin-3 flex items-center gap-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted" data-testid="tag-breadcrumb">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={goToFolders}
            className="gap-bakin-1 px-bakin-1 text-bakin-text-muted hover:text-bakin-text-primary"
            data-testid="breadcrumb-folders"
          >
            <ArrowLeft className="size-bakin-3" /> Folders
          </Button>
          <span>/</span>
          <span className="font-bakin-typography-weight-medium text-bakin-text-primary">
            {tagFilter.map(t => (t === UNTAGGED ? 'Untagged' : t)).join(', ')}
          </span>
        </div>
      )}

      {/* ─── Import view (D7 explicit import) ─── */}
      {view === 'import' ? (
        <ImportView onImported={fetchAssets} onCountChange={setImportCount} />
      ) : view === 'trash' ? (
        trash.length === 0 ? (
          <div data-testid="trash-empty">
            <SystemState
              kind="initial-empty"
              title="Trash is empty"
              description="Deleted assets will stay recoverable here until the trash is emptied."
            />
          </div>
        ) : (
          <div className="flex flex-col gap-bakin-2" data-testid="trash-list">
            <div className="mb-bakin-1 flex justify-end">
              <Button size="sm" variant="ghost" className="text-bakin-signal-danger hover:text-bakin-signal-danger/80" onClick={emptyTrash} data-testid="empty-trash">
                <Trash2 className="size-bakin-3" /> Empty trash
              </Button>
            </div>
            {/* Tabular facts read as a table (the tasks-Log ruling) — the
                bordered list variant stays for narrow/panel contexts. */}
            <DataTable
              label="Trashed assets"
              collapseBelow="none"
              rows={trash}
              rowKey={item => item.trashName}
              rowProps={item => ({ 'data-testid': `trash-row-${item.assetId}` })}
              tableProps={{ className: 'min-w-max' }}
              columns={[
                {
                  key: 'asset',
                  header: 'Asset',
                  narrow: 'primary',
                  headClassName: 'min-w-64',
                  cell: item => (
                    <div className="flex min-w-0 items-center gap-bakin-3">
                      <div className="flex size-bakin-8 shrink-0 items-center justify-center rounded-bakin-control bg-bakin-canvas-default">
                        <AssetTypeIcon type={item.type} className="size-bakin-4" />
                      </div>
                      <p className="m-0 truncate text-bakin-typography-size-body font-bakin-typography-weight-medium text-bakin-text-primary">{item.description || item.assetId}</p>
                    </div>
                  ),
                },
                { key: 'type', header: 'Type', narrow: 'meta', cell: item => <span className="capitalize text-bakin-text-muted">{item.type}</span> },
                { key: 'versions', header: 'Versions', narrow: 'meta', cell: item => <span className="text-bakin-text-muted">{item.versionCount}</span> },
                { key: 'deleted', header: 'Deleted', narrow: 'meta', cell: item => <span className="text-bakin-text-muted">{formatAge(new Date(item.deletedAt).toISOString())}</span> },
                {
                  key: 'actions',
                  header: 'Actions',
                  hideLabel: true,
                  align: 'end',
                  cell: item => (
                    <div className="flex items-center justify-end gap-bakin-1">
                      <Button size="xs" variant="outline" onClick={() => restore(item.trashName)} data-testid={`restore-${item.assetId}`}>
                        <RotateCcw className="size-bakin-3" /> Restore
                      </Button>
                      <Button size="xs" variant="ghost" className="text-bakin-signal-danger hover:text-bakin-signal-danger/80" onClick={() => permanentDelete(item.trashName)} aria-label={`Permanently delete ${item.description || item.assetId}`} data-testid={`permanent-delete-${item.assetId}`}>
                        <X className="size-bakin-3" />
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        )
      ) : view === 'tags' ? (
        <TagFolderGrid
          assets={assets}
          filter={folderFilter}
          onOpenFolder={openFolder}
          onChanged={fetchAssets}
        />
      ) : searchUnavailable ? (
        <SearchUnavailable retry={search.retry} />
      ) : displayed.length === 0 ? (
        // A pending search with nothing settled yet (cold deep link like
        // /assets?q=beef, or a new query after an empty result) must read as
        // "searching", never as a premature "no match".
        pending ? (
          <div data-testid="assets-searching">
            <SystemState
              kind="loading"
              title="Searching assets"
              description="Keeping the last settled results available until this search finishes."
            />
          </div>
        ) : (
          <div data-testid="assets-no-match">
            <SystemState
              kind="no-results"
              title="No assets match this view"
              description="Clear the current search and filters to return to the full asset library."
              action={(
                <Button
                  variant="outline"
                  onClick={() => {
                    setQ('')
                    setTypeFilter([])
                    setTagFilter([])
                  }}
                >
                  Clear search and filters
                </Button>
              )}
            />
          </div>
        )
      ) : view === 'list' ? (
        <div data-testid="assets-list">
          {/* Tabular facts read as a table (the tasks-Log ruling): columns,
              alignment, and sortable Name/Size/Age — the browse case belongs
              to the Grid view. */}
          <DataTable
            label="Assets"
            collapseBelow="none"
            rows={sortedList}
            rowKey={asset => asset.assetId}
            onRowActivate={asset => router.push(`/assets/${encodeURIComponent(asset.assetId)}`)}
            rowActivateLabel={asset => `Open ${asset.description || asset.assetId}`}
            rowProps={asset => ({ 'data-testid': `asset-row-${asset.assetId}` })}
            tableProps={{ className: 'min-w-max' }}
            sort={listSort}
            onSortChange={(field) => {
              setListSort(prev => prev.field === field
                ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                : { field, dir: field === 'name' ? 'asc' : 'desc' })
            }}
            columns={[
              {
                key: 'select',
                header: 'Select',
                hideLabel: true,
                headClassName: 'w-12',
                cell: asset => (
                  <Checkbox
                    checked={selected.has(asset.assetId)}
                    onCheckedChange={() => toggleSelected(asset.assetId)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`${selected.has(asset.assetId) ? 'Deselect' : 'Select'} ${asset.description || asset.assetId}`}
                    data-testid={`asset-selected-${asset.assetId}`}
                  />
                ),
              },
              {
                key: 'name',
                header: 'Asset',
                sortable: true,
                headClassName: 'min-w-64',
                cell: asset => (
                  <div className="flex min-w-0 items-center gap-bakin-3">
                    <div className="size-bakin-8 shrink-0 overflow-hidden rounded-bakin-control">
                      <AssetThumb assetId={asset.assetId} type={asset.type} version={asset.currentVersion} hasThumb={asset.hasThumb} />
                    </div>
                    <div className="min-w-0">
                      <p className="m-0 truncate font-bakin-typography-weight-medium text-bakin-text-primary">{asset.description || asset.assetId}</p>
                      {scoreFor(asset.assetId) ? <ScoreOverlay info={scoreFor(asset.assetId)!} /> : null}
                    </div>
                  </div>
                ),
              },
              { key: 'type', header: 'Type', cell: asset => <span className="capitalize text-bakin-text-muted">{asset.type}</span> },
              { key: 'agent', header: 'Agent', cell: asset => <span className="text-bakin-text-muted">{asset.agent}</span> },
              {
                key: 'versions',
                header: 'Versions',
                cell: asset => asset.versionCount > 1
                  ? <span className="text-bakin-action-primary-background">{asset.versionCount}</span>
                  : <span className="text-bakin-text-muted">1</span>,
              },
              { key: 'size', header: 'Size', sortable: true, cell: asset => <span className="text-bakin-text-muted">{formatSize(asset.size)}</span> },
              { key: 'created', header: 'Age', sortable: true, cell: asset => <span className="text-bakin-text-muted">{formatAge(asset.created)}</span> },
              { key: 'enrichment', header: 'Enrichment', cell: asset => <EnrichmentDot status={asset.enrichment} /> },
              {
                key: 'actions',
                header: 'Edit',
                hideLabel: true,
                align: 'end',
                headClassName: 'w-12',
                cell: asset => (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={(e) => { e.stopPropagation(); setEditing(asset) }}
                    aria-label={`Edit ${asset.description || asset.assetId}`}
                    data-testid={`asset-edit-${asset.assetId}`}
                  >
                    <Pencil />
                  </Button>
                ),
              },
            ]}
          />
        </div>
      ) : (
        <Grid layout="auto-fill" gap="item" data-testid="assets-grid">
          {displayed.map(asset => (
            <AssetCard
              key={asset.assetId}
              asset={asset}
              scoreInfo={scoreFor(asset.assetId)}
              selected={selected.has(asset.assetId)}
              onToggleSelect={() => toggleSelected(asset.assetId)}
              onOpen={() => router.push(`/assets/${encodeURIComponent(asset.assetId)}`)}
              onEdit={() => setEditing(asset)}
            />
          ))}
        </Grid>
      )}
      </PageBody>

      {/* Floating bulk-tag bar while assets are selected. */}
      {selected.size > 0 && (
        <div className="fixed inset-x-bakin-4 bottom-bakin-4 z-40 mx-auto flex max-w-xl items-center gap-bakin-2 rounded-bakin-surface border border-bakin-border-subtle bg-bakin-canvas-default/95 px-bakin-3 py-bakin-2 shadow-bakin-elevation-overlay backdrop-blur" data-testid="bulk-tag-bar">
          <Tags className="size-bakin-4 shrink-0 text-bakin-text-muted" />
          <span className="shrink-0 text-bakin-typography-size-meta text-bakin-text-muted" data-testid="bulk-selected-count">{selected.size} selected</span>
          <div className="min-w-0 flex-1">
            <TagInput value={bulkTags} onChange={setBulkTags} suggestions={tagOptions.filter(o => o.value !== UNTAGGED).map(o => o.value)} placeholder="Add tags…" />
          </div>
          <Button size="sm" onClick={applyBulkTags} disabled={bulkBusy || bulkTags.length === 0} data-testid="bulk-apply-tags">
            {bulkBusy ? <Loader2 className="size-bakin-4 animate-spin" /> : null} Save
          </Button>
          <Button size="sm" variant="outline" onClick={startEnrich} disabled={enriching} data-testid="bulk-enrich">
            {enriching ? <Loader2 className="size-bakin-4 animate-spin" /> : <Sparkles className="size-bakin-4" />} Enrich
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} data-testid="bulk-clear-selection">Clear</Button>
          {bulkError && <p className="text-bakin-typography-size-meta text-bakin-signal-danger">{bulkError}</p>}
        </div>
      )}

      <Dialog open={confirmEnrich !== null} onOpenChange={(open) => { if (!open) setConfirmEnrich(null) }}>
        <DialogContent data-testid="reenrich-confirm">
          <DialogHeader>
            <DialogTitle>
              {confirmEnrich?.done === confirmEnrich?.total
                ? 'These assets are already enriched'
                : 'Some of these assets are already enriched'}
            </DialogTitle>
            <DialogDescription>
              {confirmEnrich && (confirmEnrich.done === confirmEnrich.total
                ? `All ${confirmEnrich.total} selected ${confirmEnrich.total === 1 ? 'asset is' : 'assets are'} already enriched for their current version. Re-enriching spends a vision turn per asset; your manual edits stay protected.`
                : `${confirmEnrich.done} of ${confirmEnrich.total} selected assets are already enriched. Enrich only the rest for free, or re-enrich everything — re-enriching spends a vision turn per asset; your manual edits stay protected.`)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmEnrich(null)} data-testid="reenrich-cancel">Cancel</Button>
            {confirmEnrich && confirmEnrich.done < confirmEnrich.total && (
              <Button variant="outline" onClick={() => bulkEnrich(false)} data-testid="reenrich-new-only">
                Enrich {confirmEnrich.total - confirmEnrich.done} new only
              </Button>
            )}
            <Button onClick={() => bulkEnrich(true)} data-testid="reenrich-all">
              Re-enrich all {confirmEnrich?.total ?? 0}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editing && (
        <AssetEditDrawer
          assetId={editing.assetId}
          initialDescription={editing.description}
          initialTags={editing.tags ?? []}
          suggestions={tagOptions.filter(o => o.value !== UNTAGGED).map(o => o.value)}
          open={editing !== null}
          onOpenChange={(open) => { if (!open) setEditing(null) }}
          onSaved={fetchAssets}
        />
      )}
    </Page>
  )
}
