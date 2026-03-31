'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAssets, useTrash } from '@/hooks/use-assets'
import { AssetsGrid } from './assets-grid'
import { AssetsList } from './assets-list'
import { TrashGrid } from './trash-grid'
import { AssetDetail } from './asset-detail'
import { AssetFilters } from './asset-filters'
import type { AssetMeta } from '@/types'

export function AssetsPage() {
  const [typeFilter, setTypeFilter] = useState<string[]>([])
  const [isTrash, setIsTrash] = useState(false)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [search, setSearch] = useState('')
  const [selectedAsset, setSelectedAsset] = useState<AssetMeta | null>(null)
  const searchParams = useSearchParams()
  const router = useRouter()
  const highlightHandled = useRef(false)

  // Pass first selected type or 'all' to the hook (hook expects single string)
  const hookType = typeFilter.length === 0 ? 'all' : typeFilter.length === 1 ? typeFilter[0] : 'all'
  const { assets, loading, deleteAsset } = useAssets({ type: isTrash ? 'all' : hookType })
  const trash = useTrash()

  // Auto-open asset from ?highlight= deep link
  useEffect(() => {
    if (loading || highlightHandled.current) return
    const highlight = searchParams.get('highlight')
    if (!highlight) return

    const match = assets.find(a => a.path === highlight)
    if (match) {
      setSelectedAsset(match)
      highlightHandled.current = true
      // Clear the param so refresh doesn't re-open
      router.replace('/assets', { scroll: false })
    }
  }, [assets, loading, searchParams, router])

  // Client-side multi-type filtering when multiple types selected
  let filtered = assets
  if (typeFilter.length > 1) {
    filtered = filtered.filter(a => typeFilter.includes(a.type))
  }
  if (search) {
    const q = search.toLowerCase()
    filtered = filtered.filter(a =>
      a.filename.toLowerCase().includes(q) ||
      a.metadata.description?.toLowerCase().includes(q) ||
      a.metadata.tags?.some(t => t.toLowerCase().includes(q)) ||
      a.metadata.agent.toLowerCase().includes(q)
    )
  }

  const activeCount = isTrash ? trash.items.length : filtered.length
  const activeLoading = isTrash ? trash.loading : loading

  return (
    <div className="p-6 flex flex-col flex-1 gap-4">
      <AssetFilters
        typeFilter={typeFilter}
        onTypeChange={setTypeFilter}
        search={search}
        onSearchChange={setSearch}
        assetCount={activeCount}
        view={view}
        onViewChange={setView}
        isTrash={isTrash}
        onTrashToggle={() => setIsTrash(prev => !prev)}
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
          assets={filtered}
          onSelect={setSelectedAsset}
          onDelete={deleteAsset}
        />
      ) : (
        <AssetsGrid
          assets={filtered}
          onSelect={setSelectedAsset}
          onDelete={deleteAsset}
        />
      )}

      {!isTrash && (
        <AssetDetail
          asset={selectedAsset}
          onClose={() => setSelectedAsset(null)}
          onDelete={async (path) => {
            const ok = await deleteAsset(path)
            if (ok) setSelectedAsset(null)
          }}
        />
      )}
    </div>
  )
}
