'use client'

import { useState } from 'react'
import { FileText, Image, Video, Music, Map, Database, Package, RotateCcw, Trash2 } from 'lucide-react'
import { formatAge, formatSize } from '@/lib/format'
import { EmptyState } from '@/components/empty-state'
import { DeleteAssetDialog } from './delete-asset-dialog'
import type { TrashedAssetMeta } from '@/types'

function daysUntil(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now()
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'expiring soon'
  if (days === 1) return '1 day left'
  return `${days} days left`
}

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

interface TrashGridProps {
  items: TrashedAssetMeta[]
  onRestore: (filename: string) => Promise<boolean>
  onPermanentDelete: (filename: string) => Promise<boolean>
  onEmptyTrash: () => Promise<boolean>
}

function TrashCard({
  item,
  onRestore,
  onPermanentDelete,
}: {
  item: TrashedAssetMeta
  onRestore: () => void
  onPermanentDelete: () => void
}) {
  const Icon = TYPE_ICONS[item.type] || Package
  const iconColor = TYPE_COLORS[item.type] || 'text-muted-foreground'

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col">
      {/* Preview area */}
      <div className="h-28 bg-zinc-900/50 flex items-center justify-center relative">
        <Icon className={`size-10 ${iconColor} opacity-30`} />
        <span className="absolute bottom-1.5 right-1.5 text-[10px] text-zinc-400 bg-black/60 px-1.5 py-0.5 rounded">
          {formatSize(item.size)}
        </span>
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <div className="flex items-start gap-2">
          <Icon className={`size-3.5 mt-0.5 shrink-0 ${iconColor}`} />
          <span className="text-sm font-medium text-foreground truncate flex-1" title={item.originalFilename}>
            {item.originalFilename}
          </span>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>Deleted {formatAge(item.deletedAt)}</span>
          <span className="text-muted-foreground/50">|</span>
          <span className="text-amber-400/80">{daysUntil(item.expiresAt)}</span>
        </div>

        {item.metadata?.agent && (
          <div className="text-[10px] text-muted-foreground">
            by {item.metadata.agent}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-auto pt-2">
          <button
            onClick={onRestore}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs text-foreground bg-zinc-800 hover:bg-zinc-700 rounded-md px-2 py-1.5 transition-colors"
          >
            <RotateCcw className="size-3" />
            Restore
          </button>
          <button
            onClick={onPermanentDelete}
            className="flex items-center justify-center gap-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-950/30 rounded-md px-2 py-1.5 transition-colors"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>
    </div>
  )
}

export function TrashGrid({ items, onRestore, onPermanentDelete, onEmptyTrash }: TrashGridProps) {
  const [confirmItem, setConfirmItem] = useState<TrashedAssetMeta | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Trash2}
        title="Trash is empty"
        description="Deleted assets appear here for 7 days before auto-purge."
      />
    )
  }

  return (
    <>
      {/* Empty trash button */}
      <div className="flex justify-end">
        <button
          onClick={() => setConfirmEmpty(true)}
          className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-950/30 rounded-md px-3 py-1.5 transition-colors"
        >
          <Trash2 className="size-3.5" />
          Empty Trash
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {items.map(item => (
          <TrashCard
            key={item.filename}
            item={item}
            onRestore={() => onRestore(item.filename)}
            onPermanentDelete={() => setConfirmItem(item)}
          />
        ))}
      </div>

      {/* Permanent delete confirmation */}
      <DeleteAssetDialog
        open={!!confirmItem}
        filename={confirmItem?.originalFilename ?? ''}
        permanent
        onConfirm={() => {
          if (confirmItem) onPermanentDelete(confirmItem.filename)
          setConfirmItem(null)
        }}
        onCancel={() => setConfirmItem(null)}
      />

      {/* Empty trash confirmation */}
      <DeleteAssetDialog
        open={confirmEmpty}
        filename={`all ${items.length} item${items.length !== 1 ? 's' : ''}`}
        permanent
        onConfirm={() => {
          onEmptyTrash()
          setConfirmEmpty(false)
        }}
        onCancel={() => setConfirmEmpty(false)}
      />
    </>
  )
}
