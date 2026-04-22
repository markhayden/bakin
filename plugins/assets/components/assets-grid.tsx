'use client'

import { AssetCard } from './asset-card'
import { EmptyState } from "@bakin/sdk/components"
import { Images } from 'lucide-react'
import type { AssetMeta } from "@bakin/sdk/types"

export interface AssetScoreInfo {
  score: number
  indexScores?: Record<string, number>
}

interface AssetsGridProps {
  assets: AssetMeta[]
  onSelect: (asset: AssetMeta) => void
  onDelete: (path: string) => void
  /** When present, show Antfly relevance score on each card (keyed by asset path) */
  scores?: Map<string, AssetScoreInfo>
}

export function AssetsGrid({ assets, onSelect, onDelete, scores }: AssetsGridProps) {
  if (assets.length === 0) {
    return (
      <EmptyState
        icon={Images}
        title="No assets found"
        description="Agents will create assets here as they complete tasks."
      />
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {assets.map((asset) => (
        <AssetCard key={asset.path} asset={asset} onClick={() => onSelect(asset)} onDelete={onDelete} scoreInfo={scores?.get(asset.path)} />
      ))}
    </div>
  )
}
