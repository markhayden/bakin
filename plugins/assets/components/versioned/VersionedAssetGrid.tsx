'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryState, useQueryArrayState, useSearch, useDebug } from '@makinbakin/sdk/hooks'
import { Badge, Button } from '@makinbakin/sdk/ui'
import { PluginHeader, FacetFilter } from '@makinbakin/sdk/components'
import { formatSize, formatAge } from '@makinbakin/sdk/utils'
import {
  ImagePlus, Upload, Loader2, LayoutGrid, List, Trash2, RotateCcw, X, ListFilter,
  FileText, Image as ImageIcon, Video, Music, Map as MapIcon, Database, Package,
} from 'lucide-react'
import { AssetThumb, AssetMetaSummary, AssetTypeIcon } from './atoms'
import { VERSIONED_API, UPLOAD_API, TRASH_API } from './asset-urls'
import type { VersionedAssetSummary, TrashedAssetSummary } from './types'

type View = 'grid' | 'list' | 'trash'

const VIEW_OPTIONS: Array<{ key: View; label: string; Icon: typeof LayoutGrid }> = [
  { key: 'grid', label: 'Grid', Icon: LayoutGrid },
  { key: 'list', label: 'List', Icon: List },
  { key: 'trash', label: 'Trash', Icon: Trash2 },
]

// Full asset-type taxonomy with icons (drives the Type facet).
const TYPE_OPTIONS = [
  { value: 'text', label: 'Text', icon: <FileText className="size-3.5" /> },
  { value: 'images', label: 'Images', icon: <ImageIcon className="size-3.5" /> },
  { value: 'video', label: 'Video', icon: <Video className="size-3.5" /> },
  { value: 'audio', label: 'Audio', icon: <Music className="size-3.5" /> },
  { value: 'plans', label: 'Plans', icon: <MapIcon className="size-3.5" /> },
  { value: 'research', label: 'Research', icon: <FileText className="size-3.5" /> },
  { value: 'pdf', label: 'PDF', icon: <FileText className="size-3.5" /> },
  { value: 'data', label: 'Data', icon: <Database className="size-3.5" /> },
  { value: 'other', label: 'Other', icon: <Package className="size-3.5" /> },
]

/** Per-result Antfly relevance breakdown. */
export interface AssetScoreInfo { score: number; indexScores?: Record<string, number> }

/**
 * Search-relevance debug overlay. bakin_assets is multimodal: Bleve BM25 +
 * assets_text (BGE text embeddings) + assets_visual (CLIP on pixels). The Bleve
 * index key is an absolute path containing "bleve"/"full_text", so detect it by
 * substring rather than a fixed key.
 */
function ScoreOverlay({ info, className = '' }: { info: AssetScoreInfo; className?: string }) {
  const scores = info.indexScores ?? {}
  const bm25Key = Object.keys(scores).find(k => /bleve|full_text/.test(k))
  const bm25 = bm25Key ? scores[bm25Key] ?? 0 : 0
  const txt = scores['assets_text'] ?? 0
  const vis = scores['assets_visual'] ?? 0
  return (
    <div className={`flex flex-col gap-0.5 rounded bg-black/80 px-1.5 py-1 font-mono text-[9px] ${className}`} data-testid="score-overlay">
      <span className="text-amber-400">RRF {info.score.toFixed(4)}</span>
      <span className="text-cyan-400">BM25 {bm25.toFixed(4)}</span>
      <span className="text-purple-400">TXT {txt.toFixed(4)}</span>
      <span className="text-pink-400">VIS {vis.toFixed(4)}</span>
    </div>
  )
}

function AssetCard({ asset, onOpen, scoreInfo }: { asset: VersionedAssetSummary; onOpen: () => void; scoreInfo?: AssetScoreInfo }) {
  return (
    <div
      onClick={onOpen}
      className="flex cursor-pointer flex-col overflow-hidden rounded-lg border border-border bg-card transition-all duration-150 hover:-translate-y-0.5 hover:border-[rgba(255,255,255,0.15)]"
      data-testid={`asset-card-${asset.assetId}`}
    >
      <div className="relative h-32 overflow-hidden bg-zinc-900/50">
        <AssetThumb assetId={asset.assetId} type={asset.type} hasThumb={asset.hasThumb} />
        {scoreInfo && <ScoreOverlay info={scoreInfo} className="absolute right-1.5 top-1.5 z-10" />}
        {asset.versionCount > 1 && (
          <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300" data-testid="version-badge">
            v{asset.currentVersion} · {asset.versionCount} versions
          </span>
        )}
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-zinc-400">
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

function AssetListRow({ asset, onOpen, scoreInfo }: { asset: VersionedAssetSummary; onOpen: () => void; scoreInfo?: AssetScoreInfo }) {
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-left transition-colors hover:border-[rgba(255,255,255,0.15)]"
      data-testid={`asset-row-${asset.assetId}`}
    >
      <div className="size-10 shrink-0 overflow-hidden rounded">
        <AssetThumb assetId={asset.assetId} type={asset.type} hasThumb={asset.hasThumb} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{asset.description || asset.assetId}</p>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="capitalize">{asset.type}</span>
          <span>·</span>
          <span>{asset.agent}</span>
          {asset.versionCount > 1 && <><span>·</span><span className="text-emerald-400">v{asset.currentVersion} of {asset.versionCount}</span></>}
        </div>
      </div>
      {scoreInfo && <ScoreOverlay info={scoreInfo} className="shrink-0" />}
      <span className="shrink-0 text-[11px] text-muted-foreground">{formatSize(asset.size)}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{formatAge(asset.created)}</span>
    </button>
  )
}

export function VersionedAssetGrid() {
  const navigate = useNavigate()
  const [debug] = useDebug()
  const [linkTo] = useQueryState('linkTo', '')
  const [q, setQ] = useQueryState('q', '')
  const [view, setView] = useQueryState('view', 'grid')
  const [typeFilter, setTypeFilter] = useQueryArrayState('type')

  const [assets, setAssets] = useState<VersionedAssetSummary[]>([])
  const [trash, setTrash] = useState<TrashedAssetSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Antfly-backed search (semantic + visual), with a client-side metadata
  // fallback when search is disabled or returns nothing.
  const search = useSearch({
    plugin: 'assets',
    facets: ['asset_type', 'agent'],
    fallback: (query: string) => {
      const n = query.toLowerCase()
      return assets
        .filter(a =>
          a.assetId.toLowerCase().includes(n) ||
          a.description.toLowerCase().includes(n) ||
          a.agent.toLowerCase().includes(n) ||
          (a.tags || []).some(t => t.toLowerCase().includes(n)),
        )
        .map(a => ({ id: a.assetId, table: 'bakin_assets', score: 1, fields: {} }))
    },
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

  useEffect(() => { fetchAssets(); fetchTrash() }, [fetchAssets, fetchTrash])

  // Drive the search hook from the URL query.
  useEffect(() => { search.search(q) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const es = new EventSource('/api/events')
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'plugin-event' && (data.event === 'asset.changed' || data.event === 'asset.removed')) {
          fetchAssets(); fetchTrash()
        }
      } catch { /* ignore non-JSON */ }
    }
    return () => es.close()
  }, [fetchAssets, fetchTrash])

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

  const scoreMap = useMemo(
    () => new Map<string, AssetScoreInfo>(search.results.map(r => [r.id, { score: r.score, indexScores: r.indexScores }])),
    [search.results],
  )
  const scoreFor = (assetId: string): AssetScoreInfo | undefined => (debug && q.trim() ? scoreMap.get(assetId) : undefined)

  const filtered = useMemo(() => {
    const searching = q.trim().length > 0
    let list = assets.filter(a => typeFilter.length === 0 || typeFilter.includes(a.type))
    if (searching) {
      const score = new Map<string, number>(search.results.map(r => [r.id, r.score] as [string, number]))
      list = list
        .filter(a => score.has(a.assetId))
        .sort((a, b) => (score.get(b.assetId) ?? 0) - (score.get(a.assetId) ?? 0))
    }
    return list
  }, [assets, typeFilter, q, search.results])

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
      <Button size="sm" onClick={openPicker} disabled={uploading} data-testid="add-asset">
        {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {uploading ? 'Uploading…' : 'Add asset'}
      </Button>
      {viewToggle}
    </div>
  )

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
        count={view === 'trash' ? trash.length : filtered.length}
        actions={actions}
        search={view === 'trash' ? undefined : { value: q, onChange: setQ, placeholder: 'Search assets…' }}
      />

      {uploadError && <p className="mb-2 text-xs text-destructive">{uploadError}</p>}
      {linkTo && view !== 'trash' && <p className="mb-2 text-xs text-muted-foreground">New uploads will be linked to this task.</p>}

      {view !== 'trash' && (
        <div className="mb-3 mt-3 flex items-center gap-2" data-testid="asset-filters">
          <ListFilter className="size-3.5 shrink-0 text-muted-foreground" />
          <FacetFilter label="Type" options={TYPE_OPTIONS} selected={typeFilter} onChange={setTypeFilter} counts={typeCounts} />
        </div>
      )}

      {/* ─── Trash view ─── */}
      {view === 'trash' ? (
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
      ) : filtered.length === 0 ? (
        <div className="p-8 text-sm text-muted-foreground" data-testid="assets-no-match">No assets match your filters.</div>
      ) : view === 'list' ? (
        <div className="flex flex-col gap-1.5" data-testid="assets-list">
          {filtered.map(asset => (
            <AssetListRow key={asset.assetId} asset={asset} scoreInfo={scoreFor(asset.assetId)} onOpen={() => navigate({ to: '/assets/$assetId', params: { assetId: asset.assetId } })} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" data-testid="assets-grid">
          {filtered.map(asset => (
            <AssetCard key={asset.assetId} asset={asset} scoreInfo={scoreFor(asset.assetId)} onOpen={() => navigate({ to: '/assets/$assetId', params: { assetId: asset.assetId } })} />
          ))}
        </div>
      )}
    </div>
  )
}
