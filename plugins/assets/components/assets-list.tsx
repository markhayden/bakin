'use client'

import { useState } from 'react'
import { FileText, Image, Video, Music, Map, Database, Package, Clock, MoreHorizontal, Trash2 } from 'lucide-react'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { AgentAvatar } from '@/components/agent-avatar'
import { SortableHead } from '@/components/sortable-head'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { formatAge, formatSize } from '@/lib/format'
import { DeleteAssetDialog } from './delete-asset-dialog'
import type { AssetScoreInfo } from './assets-grid'
import type { AssetMeta } from '@/types'

const TYPE_ICONS: Record<string, typeof FileText> = {
  text: FileText,
  images: Image,
  video: Video,
  audio: Music,
  plans: Map,
  data: Database,
  other: Package,
}

const TYPE_COLORS: Record<string, string> = {
  text: 'text-blue-400',
  images: 'text-emerald-400',
  video: 'text-purple-400',
  audio: 'text-amber-400',
  plans: 'text-cyan-400',
  data: 'text-orange-400',
  other: 'text-muted-foreground',
}

export type SortField = 'name' | 'type' | 'size' | 'created'
export type SortDir = 'asc' | 'desc'

interface AssetsListProps {
  assets: AssetMeta[]
  onSelect: (asset: AssetMeta) => void
  onDelete: (path: string) => void
  sort?: SortField
  sortDir?: SortDir
  onSort?: (field: SortField) => void
  /** When true, sort headers are disabled — used while an Antfly search is
   *  active so relevance order wins over user-chosen column sort. */
  isSearching?: boolean
  /** Per-row relevance scores from Antfly, keyed by asset.path. When present
   *  together with `showScores`, each row renders an RRF/BM25/SEM overlay. */
  scoreMap?: Map<string, AssetScoreInfo>
  /** Render the debug score overlay on each row. Usually `debug && !!search`. */
  showScores?: boolean
}

function AssetRow({
  asset,
  onClick,
  onDelete,
  scoreInfo,
}: {
  asset: AssetMeta
  onClick: () => void
  onDelete: (path: string) => void
  scoreInfo?: AssetScoreInfo
}) {
  const [imgError, setImgError] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const Icon = TYPE_ICONS[asset.type] || Package
  const iconColor = TYPE_COLORS[asset.type] || 'text-muted-foreground'
  const isImage = asset.type === 'images'
  const thumbnailVariant = asset.variants?.find(v => v.role === 'thumbnail')
  const previewPath = thumbnailVariant ? thumbnailVariant.path : asset.path
  const previewUrl = `/api/plugins/assets/file?path=${encodeURIComponent(previewPath)}&v=${asset.mtimeMs || ''}`

  // Assets is a multimodal table: Bleve BM25 + assets_text + assets_visual.
  // Bleve's key is an absolute index path containing "bleve", so detect it by
  // substring; everything else is a semantic index. We show BM25 alongside the
  // visual and text embedding scores so you can see which modality hit.
  const scores = scoreInfo?.indexScores ?? {}
  const bm25Key = Object.keys(scores).find(k => /bleve|full_text/.test(k))
  const bm25 = bm25Key ? scores[bm25Key] ?? 0 : 0
  const txt = scores['assets_text'] ?? 0
  const vis = scores['assets_visual'] ?? 0

  return (
    <>
      <TableRow
        onClick={onClick}
        className="group cursor-pointer"
      >
        {/* Preview + name */}
        <TableCell className="max-w-[400px]">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded bg-zinc-900/50 flex items-center justify-center shrink-0 overflow-hidden">
              {isImage && !imgError ? (
                <img
                  src={previewUrl}
                  alt={asset.filename}
                  onError={() => setImgError(true)}
                  className="size-8 object-cover rounded"
                  loading="lazy"
                />
              ) : (
                <Icon className={`size-4 ${iconColor} opacity-60`} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm text-foreground truncate block">{asset.filename}</span>
              {asset.metadata.description && (
                <span className="text-[10px] text-muted-foreground truncate block">{asset.metadata.description}</span>
              )}
              {scoreInfo && (
                <span className="flex items-center gap-2 font-mono text-[10px] mt-0.5">
                  <span className="text-amber-400">RRF {scoreInfo.score.toFixed(4)}</span>
                  <span className="text-cyan-400">BM25 {bm25.toFixed(4)}</span>
                  <span className="text-purple-400">TXT {txt.toFixed(4)}</span>
                  <span className="text-pink-400">VIS {vis.toFixed(4)}</span>
                </span>
              )}
            </div>
          </div>
        </TableCell>
        <TableCell className="hidden sm:table-cell">
          <Badge variant="outline" className="text-[10px] h-4">
            {asset.type}
          </Badge>
        </TableCell>
        <TableCell className="hidden md:table-cell text-right text-xs text-muted-foreground w-16">
          {formatSize(asset.size)}
        </TableCell>
        <TableCell className="hidden lg:table-cell w-24">
          <div className="flex items-center gap-1.5">
            <AgentAvatar agentId={asset.metadata.agent} size="xs" />
            <span className="text-xs text-muted-foreground truncate">{asset.metadata.agent}</span>
          </div>
        </TableCell>
        <TableCell className="hidden lg:table-cell w-20">
          <div className="flex items-center gap-1">
            <Clock className="size-3 text-muted-foreground/50" />
            <span className="text-[10px] text-muted-foreground">{formatAge(asset.metadata.created)}</span>
          </div>
        </TableCell>
        <TableCell className="w-8">
          <DropdownMenu>
            <DropdownMenuTrigger
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
            >
              <MoreHorizontal className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
              <DropdownMenuItem
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); setConfirmOpen(true) }}
                className="text-red-400 focus:text-red-400"
              >
                <Trash2 className="size-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>

      <DeleteAssetDialog
        open={confirmOpen}
        filename={asset.filename}
        onConfirm={() => { setConfirmOpen(false); onDelete(asset.path) }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}

export function AssetsList({
  assets,
  onSelect,
  onDelete,
  sort = 'created',
  sortDir = 'desc',
  onSort,
  isSearching,
  scoreMap,
  showScores,
}: AssetsListProps) {
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

  const noop = () => {}
  const handleSort = onSort ?? noop

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead field="name" current={sort} dir={sortDir} onSort={handleSort} disabled={isSearching}>
            Name
          </SortableHead>
          <SortableHead field="type" current={sort} dir={sortDir} onSort={handleSort} disabled={isSearching}>
            Type
          </SortableHead>
          <SortableHead field="size" current={sort} dir={sortDir} onSort={handleSort} disabled={isSearching}>
            Size
          </SortableHead>
          <TableHead className="hidden lg:table-cell">Agent</TableHead>
          <SortableHead field="created" current={sort} dir={sortDir} onSort={handleSort} disabled={isSearching}>
            Created
          </SortableHead>
          <TableHead className="w-8"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {assets.map(asset => (
          <AssetRow
            key={asset.path}
            asset={asset}
            onClick={() => onSelect(asset)}
            onDelete={onDelete}
            scoreInfo={showScores ? scoreMap?.get(asset.path) : undefined}
          />
        ))}
      </TableBody>
    </Table>
  )
}
