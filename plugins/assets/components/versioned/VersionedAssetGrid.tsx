'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryState, useQueryArrayState, useSearch, useDebug, useRouter, usePathname, useSearchParams, usePluginEvent } from '@makinbakin/sdk/hooks'
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@makinbakin/sdk/ui'
import { PluginHeader, FacetFilter, SearchUnavailable, ScoreOverlay } from '@makinbakin/sdk/components'
import { formatSize, formatAge } from '@makinbakin/sdk/utils'
import { ImagePlus, Upload, Loader2, LayoutGrid, List, Trash2, RotateCcw, X, ListFilter, FolderOpen, Pencil, Check, Tags, ArrowLeft , Inbox, Sparkles } from 'lucide-react'
import { ASSET_TYPES } from '../../lib/constants'
import { createSseRefetchScheduler } from './sse-refetch'
import { AssetEditDrawer } from './AssetEditDrawer'
import { TagFolderGrid } from './TagFolderGrid'
import { TagInput } from './TagInput'
import { UNTAGGED, matchesTagFilter } from './tag-filter'
import { AssetThumb, AssetMetaSummary, AssetTypeIcon } from './atoms'
import { VERSIONED_API, UPLOAD_API, TRASH_API, TAGS_API } from './asset-urls'
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
  icon: <AssetTypeIcon type={value} className="size-3.5" />,
}))


/** Per-result Antfly relevance breakdown (shape shared with the SDK ScoreOverlay). */
export interface AssetScoreInfo { score: number; indexScores?: Record<string, number> }

const ENRICHMENT_BADGE: Record<VersionedAssetSummary['enrichment'], { className: string; label: string }> = {
  done: { className: 'text-emerald-400', label: 'Enriched — searchable by derived caption/tags' },
  stale: { className: 'text-amber-400', label: 'Enriched for an older version — re-enrich to refresh' },
  pending: { className: 'text-sky-400 animate-pulse', label: 'Enrichment in progress' },
  failed: { className: 'text-red-400', label: 'Enrichment failed — see asset detail' },
  skipped: { className: 'text-zinc-500', label: 'Enrichment skipped (unsupported or no engine)' },
  none: { className: 'text-zinc-600', label: 'Not enriched yet — select and hit Enrich' },
}

function EnrichmentDot({ status }: { status: VersionedAssetSummary['enrichment'] }) {
  const badge = ENRICHMENT_BADGE[status] ?? ENRICHMENT_BADGE.none
  return (
    <span title={badge.label} data-testid={`enrichment-dot-${status}`} className="flex items-center">
      <Sparkles className={`size-3 ${badge.className}`} />
    </span>
  )
}

function AssetCard({ asset, onOpen, onEdit, selected, onToggleSelect, scoreInfo }: { asset: VersionedAssetSummary; onOpen: () => void; onEdit: () => void; selected: boolean; onToggleSelect: () => void; scoreInfo?: AssetScoreInfo }) {
  return (
    <div
      onClick={onOpen}
      className={`group flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-card transition-all duration-150 hover:-translate-y-0.5 ${selected ? 'border-emerald-500/70 ring-1 ring-emerald-500/50' : 'border-border hover:border-[rgba(255,255,255,0.15)]'}`}
      data-testid={`asset-card-${asset.assetId}`}
    >
      <div className="relative aspect-square overflow-hidden bg-zinc-900/50">
        <AssetThumb assetId={asset.assetId} type={asset.type} version={asset.currentVersion} hasThumb={asset.hasThumb} />
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect() }}
          className={`absolute left-1.5 top-1.5 z-10 flex size-5 items-center justify-center rounded border transition-colors ${selected ? 'border-emerald-500 bg-emerald-500 text-black' : 'border-zinc-500 bg-black/60 hover:border-zinc-300'}`}
          aria-label={selected ? 'Deselect asset' : 'Select asset'}
          data-testid={`asset-selected-${asset.assetId}`}
        >
          {selected && <Check className="size-3.5" />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onEdit() }}
          className="absolute right-1.5 top-1.5 z-10 rounded bg-black/60 p-1.5 text-zinc-300 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
          aria-label={`Edit ${asset.description || asset.assetId}`}
          data-testid={`asset-edit-${asset.assetId}`}
        >
          <Pencil className="size-3.5" />
        </button>
        {scoreInfo && <ScoreOverlay info={scoreInfo} className="absolute left-1.5 top-1.5 z-10" />}
        {asset.versionCount > 1 && (
          <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300" data-testid="version-badge">
            {asset.versionCount} versions
          </span>
        )}
        <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-zinc-400">
          <EnrichmentDot status={asset.enrichment} />
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

function AssetListRow({ asset, onOpen, onEdit, selected, onToggleSelect, scoreInfo }: { asset: VersionedAssetSummary; onOpen: () => void; onEdit: () => void; selected: boolean; onToggleSelect: () => void; scoreInfo?: AssetScoreInfo }) {
  return (
    <div
      onClick={onOpen}
      className={`group flex w-full cursor-pointer items-center gap-3 rounded-md border bg-card px-3 py-2 text-left transition-colors ${selected ? 'border-emerald-500/70 ring-1 ring-emerald-500/50' : 'border-border hover:border-[rgba(255,255,255,0.15)]'}`}
      data-testid={`asset-row-${asset.assetId}`}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onToggleSelect() }}
        className={`flex size-4.5 shrink-0 items-center justify-center rounded border transition-colors ${selected ? 'border-emerald-500 bg-emerald-500 text-black' : 'border-zinc-500 hover:border-zinc-300'}`}
        aria-label={selected ? 'Deselect asset' : 'Select asset'}
        data-testid={`asset-selected-${asset.assetId}`}
      >
        {selected && <Check className="size-3" />}
      </button>
      <div className="size-10 shrink-0 overflow-hidden rounded">
        <AssetThumb assetId={asset.assetId} type={asset.type} version={asset.currentVersion} hasThumb={asset.hasThumb} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{asset.description || asset.assetId}</p>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="capitalize">{asset.type}</span>
          <span>·</span>
          <span>{asset.agent}</span>
          {asset.versionCount > 1 && <><span>·</span><span className="text-emerald-400">{asset.versionCount} versions</span></>}
        </div>
      </div>
      {scoreInfo && <ScoreOverlay info={scoreInfo} className="shrink-0" />}
      <EnrichmentDot status={asset.enrichment} />
      <button
        onClick={(e) => { e.stopPropagation(); onEdit() }}
        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
        aria-label={`Edit ${asset.description || asset.assetId}`}
        data-testid={`asset-edit-${asset.assetId}`}
      >
        <Pencil className="size-3.5" />
      </button>
      <span className="shrink-0 text-[11px] text-muted-foreground">{formatSize(asset.size)}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{formatAge(asset.created)}</span>
    </div>
  )
}

export function VersionedAssetGrid() {
  const navigate = useNavigate()
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
      const res = await fetch('/api/plugins/assets/enrich', {
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
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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

  const viewToggle = (
    <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
      {VIEW_OPTIONS.map(({ key, label, Icon }) => (
        <button
          key={key}
          onClick={() => setView(key)}
          data-testid={`view-${key}`}
          className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${view === key ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <Icon className="size-3.5" /> {label}
        </button>
      ))}
    </div>
  )

  const actions = (
    <div className="flex items-center gap-2">
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" data-testid="search-spinner" />}
      <Button size="sm" onClick={openPicker} disabled={uploading} data-testid="add-asset">
        {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {uploading ? 'Uploading…' : 'Add asset'}
      </Button>
      {viewToggle}
    </div>
  )

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

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading assets…</div>

  // True empty state (no assets at all, not in trash view) — promote upload.
  if (assets.length === 0 && view !== 'trash') {
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
    <div className="p-4" data-testid="assets-browser">
      {fileInput}
      <PluginHeader
        title="Assets"
        count={view === 'trash' ? trash.length : view === 'import' ? undefined : view === 'tags' ? folderCount : displayed.length}
        actions={actions}
        search={view === 'trash' || view === 'import' ? undefined : view === 'tags'
          ? { value: q, onChange: setQ, placeholder: 'Filter folders…' }
          : { value: q, onChange: setQ, placeholder: 'Search assets…' }}
      />

      {uploadError && <p className="mb-2 text-xs text-destructive">{uploadError}</p>}
      {linkTo && view !== 'trash' && <p className="mb-2 text-xs text-muted-foreground">New uploads will be linked to this task.</p>}

      {view !== 'trash' && view !== 'tags' && (
        <div className="mb-3 mt-3 flex items-center gap-2" data-testid="asset-filters">
          <ListFilter className="size-3.5 shrink-0 text-muted-foreground" />
          <FacetFilter label="Type" options={TYPE_OPTIONS} selected={typeFilter} onChange={setTypeFilter} counts={typeCounts} />
          <FacetFilter label="Tags" options={tagOptions} selected={tagFilter} onChange={setTagFilter} counts={tagCounts} />
        </div>
      )}

      {/* Breadcrumb back to the folders view while a tag filter is active.
          Clearing the filter happens via the Tags facet; the breadcrumb is
          purely a "go back" affordance. */}
      {view !== 'trash' && view !== 'tags' && tagFilter.length > 0 && (
        <div className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="tag-breadcrumb">
          <button
            onClick={goToFolders}
            className="flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground"
            data-testid="breadcrumb-folders"
          >
            <ArrowLeft className="size-3.5" /> Folders
          </button>
          <span>/</span>
          <span className="font-medium text-foreground">
            {tagFilter.map(t => (t === UNTAGGED ? 'Untagged' : t)).join(', ')}
          </span>
        </div>
      )}

      {/* ─── Import view (D7 explicit import) ─── */}
      {view === 'import' ? (
        <ImportView onImported={fetchAssets} />
      ) : view === 'trash' ? (
        trash.length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground" data-testid="trash-empty">Trash is empty.</div>
        ) : (
          <div className="flex flex-col gap-2" data-testid="trash-list">
            <div className="mb-1 flex justify-end">
              <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300" onClick={emptyTrash} data-testid="empty-trash">
                <Trash2 className="size-3.5" /> Empty trash
              </Button>
            </div>
            {trash.map(item => (
              <div key={item.trashName} className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2" data-testid={`trash-row-${item.assetId}`}>
                <div className="flex size-9 shrink-0 items-center justify-center rounded bg-zinc-900/50">
                  <AssetTypeIcon type={item.type} className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{item.description || item.assetId}</p>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="capitalize">{item.type}</span><span>·</span>
                    <span>{item.versionCount} version{item.versionCount === 1 ? '' : 's'}</span><span>·</span>
                    <span>deleted {formatAge(new Date(item.deletedAt).toISOString())}</span>
                  </div>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => restore(item.trashName)} data-testid={`restore-${item.assetId}`}>
                  <RotateCcw className="size-3.5" /> Restore
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-red-400 hover:text-red-300" onClick={() => permanentDelete(item.trashName)} data-testid={`permanent-delete-${item.assetId}`}>
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
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
          <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground" data-testid="assets-searching">
            <Loader2 className="size-4 animate-spin" />
            Searching assets…
          </div>
        ) : (
          <div className="p-8 text-sm text-muted-foreground" data-testid="assets-no-match">No assets match your filters.</div>
        )
      ) : view === 'list' ? (
        <div className="flex flex-col gap-1.5" data-testid="assets-list">
          {displayed.map(asset => (
            <AssetListRow
              key={asset.assetId}
              asset={asset}
              scoreInfo={scoreFor(asset.assetId)}
              selected={selected.has(asset.assetId)}
              onToggleSelect={() => toggleSelected(asset.assetId)}
              onOpen={() => navigate({ to: '/assets/$assetId', params: { assetId: asset.assetId } })}
              onEdit={() => setEditing(asset)}
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]" data-testid="assets-grid">
          {displayed.map(asset => (
            <AssetCard
              key={asset.assetId}
              asset={asset}
              scoreInfo={scoreFor(asset.assetId)}
              selected={selected.has(asset.assetId)}
              onToggleSelect={() => toggleSelected(asset.assetId)}
              onOpen={() => navigate({ to: '/assets/$assetId', params: { assetId: asset.assetId } })}
              onEdit={() => setEditing(asset)}
            />
          ))}
        </div>
      )}

      {/* Floating bulk-tag bar while assets are selected. */}
      {selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 z-40 flex w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-lg backdrop-blur" data-testid="bulk-tag-bar">
          <Tags className="size-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-xs text-muted-foreground" data-testid="bulk-selected-count">{selected.size} selected</span>
          <div className="min-w-0 flex-1">
            <TagInput value={bulkTags} onChange={setBulkTags} suggestions={tagOptions.filter(o => o.value !== UNTAGGED).map(o => o.value)} placeholder="Add tags…" />
          </div>
          <Button size="sm" onClick={applyBulkTags} disabled={bulkBusy || bulkTags.length === 0} data-testid="bulk-apply-tags">
            {bulkBusy ? <Loader2 className="size-4 animate-spin" /> : null} Save
          </Button>
          <Button size="sm" variant="outline" onClick={startEnrich} disabled={enriching} title="Vision-enrich selected assets" data-testid="bulk-enrich">
            {enriching ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Enrich
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} data-testid="bulk-clear-selection">Clear</Button>
          {bulkError && <p className="text-xs text-destructive">{bulkError}</p>}
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
    </div>
  )
}
