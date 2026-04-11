'use client'

import { useState } from 'react'
import { FileText, Image, Video, Music, Map, Database, Package, Clock, MoreHorizontal, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { AgentAvatar } from '@/components/agent-avatar'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { formatAge, formatSize } from '@/lib/format'
import { DeleteAssetDialog } from './delete-asset-dialog'
import type { AssetMeta } from '@/types'
import type { AssetScoreInfo } from './assets-grid'

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

interface AssetCardProps {
  asset: AssetMeta
  onClick: () => void
  onDelete: (path: string) => void
  /** Antfly score info (only shown when debug=true) */
  scoreInfo?: AssetScoreInfo
}

export function AssetCard({ asset, onClick, onDelete, scoreInfo }: AssetCardProps) {
  const [imgError, setImgError] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const Icon = TYPE_ICONS[asset.type] || Package
  const iconColor = TYPE_COLORS[asset.type] || 'text-muted-foreground'

  const isImage = asset.type === 'images'
  const showPreview = isImage && !imgError

  // Prefer thumbnail variant for grid preview (much smaller file size)
  const thumbnailVariant = asset.variants?.find(v => v.role === 'thumbnail')
  const previewPath = thumbnailVariant ? thumbnailVariant.path : asset.path
  const previewUrl = `/api/plugins/assets/file?path=${encodeURIComponent(previewPath)}&v=${asset.mtimeMs || ''}`
  const fullUrl = `/api/plugins/assets/file?path=${encodeURIComponent(asset.path)}&v=${asset.mtimeMs || ''}`

  const card = (
    <div
      onClick={onClick}
      className="text-left rounded-lg border border-border bg-card hover:border-[rgba(255,255,255,0.15)] transition-all duration-150 hover:-translate-y-0.5 overflow-hidden flex flex-col cursor-pointer"
    >
      {/* Preview area */}
      <div className="h-32 bg-zinc-900/50 flex items-center justify-center relative overflow-hidden">
        {showPreview ? (
          <img
            src={previewUrl}
            alt={asset.filename}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <Icon className={`size-10 ${iconColor} opacity-40`} />
        )}

        {/* Action menu */}
        <DropdownMenu>
          <DropdownMenuTrigger
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className="absolute top-1.5 right-1.5 p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-zinc-400 hover:text-zinc-200 transition-colors"
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

        {/* Size badge */}
        <span className="absolute bottom-1.5 right-1.5 text-[10px] text-zinc-400 bg-black/60 px-1.5 py-0.5 rounded">
          {formatSize(asset.size)}
        </span>

        {/* Antfly relevance score debug overlay */}
        {scoreInfo && (
          <div className="absolute top-1.5 left-1.5 flex flex-col gap-0.5 text-[9px] font-mono bg-black/80 px-1.5 py-1 rounded">
            <span className="text-amber-400">RRF {scoreInfo.score.toFixed(4)}</span>
            {scoreInfo.indexScores && Object.entries(scoreInfo.indexScores).map(([idx, s]) => (
              <span key={idx} className={idx === 'embeddings' ? 'text-purple-400' : 'text-cyan-400'}>
                {idx === 'embeddings' ? 'SEM' : 'BM25'} {(s as number).toFixed(4)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Info area */}
      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <div className="flex items-start gap-2">
          <Icon className={`size-3.5 mt-0.5 shrink-0 ${iconColor}`} />
          <span className="text-sm font-medium text-foreground truncate flex-1" title={asset.filename}>
            {asset.filename}
          </span>
        </div>

        {asset.metadata.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {asset.metadata.description}
          </p>
        )}

        <div className="flex items-center gap-2 mt-auto pt-1">
          {/* Agent */}
          <div className="flex items-center gap-1">
            <AgentAvatar agentId={asset.metadata.agent} size="xs" />
            <span className="text-[10px] text-muted-foreground">{asset.metadata.agent}</span>
          </div>

          <span className="text-[10px] text-muted-foreground/50">|</span>

          {/* Time */}
          <div className="flex items-center gap-1">
            <Clock className="size-3 text-muted-foreground/50" />
            <span className="text-[10px] text-muted-foreground">{formatAge(asset.metadata.created)}</span>
          </div>

          {/* Task link */}
          {asset.metadata.taskId && (
            <>
              <span className="text-[10px] text-muted-foreground/50">|</span>
              <Badge variant="outline" className="text-[9px] h-4 px-1">
                {asset.metadata.taskId.slice(0, 6)}
              </Badge>
            </>
          )}
        </div>

        {/* Tags */}
        {asset.metadata.tags && asset.metadata.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {asset.metadata.tags.slice(0, 3).map(tag => (
              <Badge key={tag} variant="secondary" className="text-[9px] h-4 px-1.5">
                {tag}
              </Badge>
            ))}
            {asset.metadata.tags.length > 3 && (
              <span className="text-[9px] text-muted-foreground">+{asset.metadata.tags.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      {showPreview ? (
        <TooltipProvider delay={400}>
          <Tooltip>
            <TooltipTrigger render={<div />}>
              {card}
            </TooltipTrigger>
            <TooltipContent
              side="right"
              sideOffset={8}
              className="p-1 bg-popover border border-border rounded-lg shadow-xl max-w-none w-auto"
            >
              <img
                src={fullUrl}
                alt={asset.filename}
                className="max-w-[320px] max-h-[320px] rounded-md object-contain"
              />
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : card}

      <DeleteAssetDialog
        open={confirmOpen}
        filename={asset.filename}
        onConfirm={() => { setConfirmOpen(false); onDelete(asset.path) }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}
