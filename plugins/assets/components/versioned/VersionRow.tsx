'use client'

import { Badge, Button } from '@makinbakin/sdk/ui'
import { formatAge } from '@makinbakin/sdk/utils'
import { Star, Trash2 } from 'lucide-react'
import { AssetThumb, ProvenanceChips } from './atoms'
import type { AssetVersion } from './types'

/** One entry in the version timeline. Clicking the row previews that version. */
export function VersionRow({ assetId, assetType, version, isCurrent, isSelected, canDelete, onSelect, onPromote, onDelete }: {
  assetId: string
  assetType: string
  version: AssetVersion
  isCurrent: boolean
  isSelected?: boolean
  canDelete: boolean
  onSelect?: (version: number) => void
  onPromote: (version: number) => void
  onDelete: (version: number) => void
}) {
  return (
    <div
      onClick={() => onSelect?.(version.version)}
      className={`relative flex cursor-pointer gap-3 rounded-lg border p-2.5 pr-10 transition-colors ${
        isSelected ? 'border-blue-400 ring-1 ring-blue-400/40' : isCurrent ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border hover:border-[rgba(255,255,255,0.15)]'
      }`}
      data-testid={`version-row-${version.version}`}
    >
      {/* Delete — far top-right of the box. */}
      {canDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(version.version) }}
          className="absolute right-2 top-2 text-red-400 hover:text-red-300"
          title="Delete version"
          data-testid={`delete-version-${version.version}`}
        >
          <Trash2 className="size-4" />
        </button>
      )}
      {/* Timestamp — far bottom-right. */}
      <span className="absolute bottom-2 right-2 text-[10px] text-muted-foreground">{formatAge(version.created)}</span>

      <div className="size-16 shrink-0 overflow-hidden rounded-md bg-zinc-900/50">
        <AssetThumb assetId={assetId} type={assetType} version={version.version} hasThumb={version.thumb !== null} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">v{version.version}</span>
          <Badge variant="outline" className="h-4 px-1.5 text-[9px]">{version.op}</Badge>
          {isCurrent && (
            <Badge className="h-4 bg-emerald-600 px-1.5 text-[9px] text-white" data-testid="current-badge">current</Badge>
          )}
        </div>
        {version.prompt && <p className="line-clamp-2 text-xs text-muted-foreground">{version.prompt}</p>}
        <ProvenanceChips generation={version.generation} />
        {!isCurrent && (
          <div className="pt-1">
            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={(e) => { e.stopPropagation(); onPromote(version.version) }} data-testid={`promote-${version.version}`}>
              <Star className="size-3 mr-1" /> Make current
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
