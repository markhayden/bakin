'use client'

import { useState } from 'react'
import { useAssets } from '@/hooks/use-assets'
import { AssetsGrid } from './assets-grid'
import { AssetDetail } from './asset-detail'
import { AssetFilters } from './asset-filters'
import type { AssetMeta } from '@/types'

export function AssetsPage() {
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedAsset, setSelectedAsset] = useState<AssetMeta | null>(null)

  const { assets, loading, deleteAsset } = useAssets({ type: typeFilter })

  const filtered = search
    ? assets.filter(a => {
        const q = search.toLowerCase()
        return (
          a.filename.toLowerCase().includes(q) ||
          a.metadata.description?.toLowerCase().includes(q) ||
          a.metadata.tags?.some(t => t.toLowerCase().includes(q)) ||
          a.metadata.agent.toLowerCase().includes(q)
        )
      })
    : assets

  return (
    <div className="p-6 flex flex-col flex-1 gap-4">
      <AssetFilters
        typeFilter={typeFilter}
        onTypeChange={setTypeFilter}
        search={search}
        onSearchChange={setSearch}
        assetCount={filtered.length}
      />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-sm text-muted-foreground">Loading assets...</div>
        </div>
      ) : (
        <AssetsGrid
          assets={filtered}
          onSelect={setSelectedAsset}
        />
      )}

      <AssetDetail
        asset={selectedAsset}
        onClose={() => setSelectedAsset(null)}
        onDelete={async (path) => {
          const ok = await deleteAsset(path)
          if (ok) setSelectedAsset(null)
        }}
      />
    </div>
  )
}
