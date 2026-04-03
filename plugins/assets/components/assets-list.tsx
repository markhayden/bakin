'use client'

import { useState } from 'react'
import { FileText, Image, Video, Music, Map, Database, Package, Clock, MoreHorizontal, Trash2, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { AgentAvatar } from '@/components/agent-avatar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { formatAge, formatSize } from '@/lib/format'
import { DeleteAssetDialog } from './delete-asset-dialog'
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
}

function SortIcon({ field, activeField, dir }: { field: SortField; activeField?: SortField; dir?: SortDir }) {
  if (field !== activeField) return <ArrowUpDown className="size-3 opacity-0 group-hover/col:opacity-50" />
  return dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
}

function SortableHeader({ field, label, activeField, dir, onSort, className }: {
  field: SortField
  label: string
  activeField?: SortField
  dir?: SortDir
  onSort?: (field: SortField) => void
  className?: string
}) {
  return (
    <button
      onClick={() => onSort?.(field)}
      className={`group/col flex items-center gap-1 hover:text-foreground transition-colors ${className ?? ''}`}
    >
      {label}
      <SortIcon field={field} activeField={activeField} dir={dir} />
    </button>
  )
}

function AssetRow({ asset, onClick, onDelete }: { asset: AssetMeta; onClick: () => void; onDelete: (path: string) => void }) {
  const [imgError, setImgError] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const Icon = TYPE_ICONS[asset.type] || Package
  const iconColor = TYPE_COLORS[asset.type] || 'text-muted-foreground'
  const isImage = asset.type === 'images'
  const thumbnailVariant = asset.variants?.find(v => v.role === 'thumbnail')
  const previewPath = thumbnailVariant ? thumbnailVariant.path : asset.path
  const previewUrl = `/api/plugins/assets/file?path=${encodeURIComponent(previewPath)}&v=${asset.mtimeMs || ''}`

  return (
    <>
      <div
        onClick={onClick}
        className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30 rounded-md cursor-pointer transition-colors group"
      >
        {/* Preview / Icon */}
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

        {/* Name */}
        <div className="flex-1 min-w-0">
          <span className="text-sm text-foreground truncate block">{asset.filename}</span>
          {asset.metadata.description && (
            <span className="text-[10px] text-muted-foreground truncate block">{asset.metadata.description}</span>
          )}
        </div>

        {/* Type */}
        <Badge variant="outline" className="text-[10px] h-4 shrink-0 hidden sm:flex">
          {asset.type}
        </Badge>

        {/* Size */}
        <span className="text-xs text-muted-foreground w-16 text-right shrink-0 hidden md:block">
          {formatSize(asset.size)}
        </span>

        {/* Agent */}
        <div className="flex items-center gap-1.5 w-24 shrink-0 hidden lg:flex">
          <AgentAvatar agentId={asset.metadata.agent} size="xs" />
          <span className="text-xs text-muted-foreground truncate">{asset.metadata.agent}</span>
        </div>

        {/* Created */}
        <div className="flex items-center gap-1 w-20 shrink-0 hidden lg:flex">
          <Clock className="size-3 text-muted-foreground/50" />
          <span className="text-[10px] text-muted-foreground">{formatAge(asset.metadata.created)}</span>
        </div>

        {/* Actions */}
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
      </div>

      <DeleteAssetDialog
        open={confirmOpen}
        filename={asset.filename}
        onConfirm={() => { setConfirmOpen(false); onDelete(asset.path) }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}

export function AssetsList({ assets, onSelect, onDelete, sort, sortDir, onSort }: AssetsListProps) {
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
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-1.5 text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium border-b border-border/50">
        <div className="size-8 shrink-0" />
        <div className="flex-1 min-w-0">
          <SortableHeader field="name" label="Name" activeField={sort} dir={sortDir} onSort={onSort} />
        </div>
        <div className="w-14 shrink-0 hidden sm:block">
          <SortableHeader field="type" label="Type" activeField={sort} dir={sortDir} onSort={onSort} />
        </div>
        <div className="w-16 shrink-0 hidden md:flex justify-end">
          <SortableHeader field="size" label="Size" activeField={sort} dir={sortDir} onSort={onSort} />
        </div>
        <div className="w-24 shrink-0 hidden lg:block">Agent</div>
        <div className="w-20 shrink-0 hidden lg:block">
          <SortableHeader field="created" label="Created" activeField={sort} dir={sortDir} onSort={onSort} />
        </div>
        <div className="size-6 shrink-0" />
      </div>

      {/* Rows */}
      {assets.map(asset => (
        <AssetRow
          key={asset.path}
          asset={asset}
          onClick={() => onSelect(asset)}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}
