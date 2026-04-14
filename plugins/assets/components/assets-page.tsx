'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useQueryState, useQueryArrayState } from '@/hooks/use-query-state'
import { useDebug } from '@/hooks/use-debug'
import { useSearch } from '@/hooks/use-search'
import { useAssets, useTrash } from '@/hooks/use-assets'
import { AssetsGrid } from './assets-grid'
import { AssetsList, type SortField, type SortDir } from './assets-list'
import { TrashGrid } from './trash-grid'
import { AssetDetail } from './asset-detail'
import { AssetFilters } from './asset-filters'
import { AssetPagination } from './asset-pagination'
import { UploadDialog } from './upload-dialog'
import type { AssetMeta } from '@/types'

const DEFAULT_PAGE_SIZE = 24
const STORAGE_KEY = 'assets-page-size'

function getStoredPageSize(): number {
  if (typeof window === 'undefined') return DEFAULT_PAGE_SIZE
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored ? parseInt(stored, 10) : DEFAULT_PAGE_SIZE
}

export function AssetsPage() {
  const [debug] = useDebug()
  const [view, setView] = useQueryState('view', 'grid')
  const [search, setSearch] = useQueryState('q', '')
  const [typeFilter, setTypeFilter] = useQueryArrayState('type')
  const [assetPath, setAssetPath] = useQueryState('asset', '')
  const [sort, setSort] = useQueryState('sort', 'created')
  const [sortDir, setSortDir] = useQueryState('dir', 'desc')
  const [pageStr, setPageStr] = useQueryState('page', '1')
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  // Load persisted page size from localStorage
  useEffect(() => {
    setPageSize(getStoredPageSize())
  }, [])

  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Atomic multi-param update to avoid race when resetting page alongside another param
  const updateParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') params.delete(k)
      else params.set(k, v)
    }
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, pathname, searchParams])

  const linkTo = searchParams.get('linkTo')
  const [uploadOpen, setUploadOpen] = useState(false)

  // Auto-open upload dialog when navigating from TaskAssets "Add" button
  useEffect(() => {
    if (linkTo) setUploadOpen(true)
  }, [linkTo])

  const page = Math.max(1, parseInt(pageStr, 10) || 1)
  const isTrash = view === 'trash'

  // Pass first selected type or 'all' to the hook (hook expects single string)
  const hookType = typeFilter.length === 0 ? 'all' : typeFilter.length === 1 ? typeFilter[0] : 'all'
  const { assets, total, loading, deleteAsset } = useAssets({ type: isTrash ? 'all' : hookType })
  const trash = useTrash()

  // Resolve selected asset from ?asset= param
  const selectedAsset = useMemo(() => {
    if (!assetPath || loading) return null
    return assets.find(a => a.path === assetPath) ?? null
  }, [assetPath, assets, loading])

  const searchHook = useSearch({ plugin: 'assets', facets: ['asset_type', 'agent'], debounce: 300 })
  useEffect(() => {
    if (search) searchHook.search(search)
    else searchHook.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const filtered = useMemo(() => {
    let result = assets
    if (typeFilter.length > 1) {
      result = result.filter(a => typeFilter.includes(a.type))
    }
    if (search) {
      if (searchHook.results.length) {
        const matchIds = new Set(searchHook.results.map(r => r.id))
        const scoreMap = new Map(searchHook.results.map(r => [r.id, r.score]))
        result = result
          .filter(a => matchIds.has(a.path))
          .sort((a, b) => (scoreMap.get(b.path) ?? 0) - (scoreMap.get(a.path) ?? 0))
      } else if (!searchHook.loading) {
        // Only fall back to the local substring filter once the search
        // hook has settled. During the 300ms debounce window we keep the
        // full type-filtered list so the grid doesn't flash "no matches"
        // before Antfly returns.
        const q = search.toLowerCase()
        result = result.filter(a =>
          a.filename.toLowerCase().includes(q) ||
          a.metadata.description?.toLowerCase().includes(q) ||
          a.metadata.tags?.some(t => t.toLowerCase().includes(q)) ||
          a.metadata.agent.toLowerCase().includes(q)
        )
      }
    }
    return result
  }, [assets, typeFilter, search, searchHook.results, searchHook.loading])

  const sorted = useMemo(() => {
    if (search && searchHook.results.length) return filtered
    const s = sort as SortField
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (s) {
        case 'name': return dir * a.filename.localeCompare(b.filename)
        case 'type': return dir * a.type.localeCompare(b.type)
        case 'size': return dir * (a.size - b.size)
        case 'created':
        default:
          return dir * (new Date(a.metadata.created).getTime() - new Date(b.metadata.created).getTime())
      }
    })
  }, [filtered, sort, sortDir, search, searchHook.results])

  const handleSort = (field: SortField) => {
    if (sort === field) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
    } else {
      setSort(field)
      setSortDir(field === 'name' ? 'asc' : 'desc')
    }
    setPageStr('1')
  }

  // Pagination
  const totalFiltered = sorted.length
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize))
  const safePage = Math.min(page, totalPages)
  const paged = sorted.slice((safePage - 1) * pageSize, safePage * pageSize)

  const activeCount = isTrash ? trash.items.length : totalFiltered
  const activeLoading = isTrash ? trash.loading : loading

  const handlePageChange = (p: number) => setPageStr(String(p))
  const handlePageSizeChange = (size: number) => {
    setPageSize(size)
    localStorage.setItem(STORAGE_KEY, String(size))
    setPageStr('1')
  }

  return (
    <div className="p-6 flex flex-col flex-1 gap-4">
      <AssetFilters
        typeFilter={typeFilter}
        onTypeChange={(types) => updateParams({ type: types.length ? types.join(',') : null, page: null })}
        search={search}
        onSearchChange={(q) => updateParams({ q: q || null, page: null })}
        assetCount={activeCount}
        view={view}
        onViewChange={setView}
        onAdd={() => setUploadOpen(true)}
        typeCounts={searchHook.aggregations?.asset_type ? Object.fromEntries(searchHook.aggregations.asset_type.map(a => [a.value, a.count])) : undefined}
      />

      {activeLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-sm text-muted-foreground">Loading{isTrash ? ' trash' : ' assets'}...</div>
        </div>
      ) : isTrash ? (
        <TrashGrid
          items={trash.items}
          onRestore={trash.restoreAsset}
          onPermanentDelete={trash.permanentDeleteAsset}
          onEmptyTrash={trash.emptyTrash}
        />
      ) : view === 'list' ? (
        <AssetsList
          assets={paged}
          onSelect={(a: AssetMeta) => setAssetPath(a.path)}
          onDelete={deleteAsset}
          sort={sort as SortField}
          sortDir={sortDir as SortDir}
          onSort={handleSort}
          isSearching={!!search.trim()}
        />
      ) : (
        <AssetsGrid
          assets={paged}
          onSelect={(a: AssetMeta) => setAssetPath(a.path)}
          onDelete={deleteAsset}
          scores={search && searchHook.results.length && debug ? new Map(searchHook.results.map(r => [r.id, { score: r.score, indexScores: r.indexScores }])) : undefined}
        />
      )}

      {!isTrash && (
        <AssetPagination
          page={safePage}
          pageSize={pageSize}
          total={totalFiltered}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
        />
      )}

      {!isTrash && (
        <AssetDetail
          asset={selectedAsset}
          onClose={() => setAssetPath('')}
          onDelete={async (path) => {
            const ok = await deleteAsset(path)
            if (ok) setAssetPath('')
          }}
        />
      )}

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} defaultTaskId={linkTo || undefined} />
    </div>
  )
}
