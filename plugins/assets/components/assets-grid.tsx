'use client'

import { AssetCard } from './asset-card'
import type { AssetMeta } from '@/types'

interface AssetsGridProps {
  assets: AssetMeta[]
  onSelect: (asset: AssetMeta) => void
  onDelete: (path: string) => void
}

export function AssetsGrid({ assets, onSelect, onDelete }: AssetsGridProps) {
  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm text-muted-foreground">No assets found.</p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          Agents will create assets here as they complete tasks.
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {assets.map((asset) => (
        <AssetCard key={asset.path} asset={asset} onClick={() => onSelect(asset)} onDelete={onDelete} />
      ))}
    </div>
  )
}
