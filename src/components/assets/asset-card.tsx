'use client'

import { useState } from 'react'
import { FileText, Image, Video, Music, Map, Database, Package, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { AssetMeta } from '@/types'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
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
  other: 'text-zinc-400',
}

interface AssetCardProps {
  asset: AssetMeta
  onClick: () => void
}

export function AssetCard({ asset, onClick }: AssetCardProps) {
  const [imgError, setImgError] = useState(false)
  const [agentImgError, setAgentImgError] = useState(false)
  const Icon = TYPE_ICONS[asset.type] || Package
  const iconColor = TYPE_COLORS[asset.type] || 'text-zinc-400'

  const isImage = asset.type === 'images'
  const showPreview = isImage && !imgError

  return (
    <button
      onClick={onClick}
      className="text-left rounded-lg border border-border bg-card hover:border-[rgba(255,255,255,0.15)] transition-all duration-150 hover:-translate-y-0.5 overflow-hidden flex flex-col"
    >
      {/* Preview area */}
      <div className="h-32 bg-zinc-900/50 flex items-center justify-center relative overflow-hidden">
        {showPreview ? (
          <img
            src={`/api/plugins/assets/file?path=${encodeURIComponent(asset.path)}&v=${asset.mtimeMs || ''}`}
            alt={asset.filename}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <Icon className={`size-10 ${iconColor} opacity-40`} />
        )}

        {/* Size badge */}
        <span className="absolute bottom-1.5 right-1.5 text-[10px] text-zinc-400 bg-black/60 px-1.5 py-0.5 rounded">
          {formatSize(asset.size)}
        </span>
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
            {!agentImgError ? (
              <img
                src={`/headshots/${asset.metadata.agent}.png`}
                alt={asset.metadata.agent}
                onError={() => setAgentImgError(true)}
                className="size-4 rounded-full object-cover object-top ring-1 ring-zinc-700/50"
              />
            ) : (
              <span className="size-4 rounded-full bg-zinc-700 flex items-center justify-center text-[8px] text-zinc-300">
                {asset.metadata.agent.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">{asset.metadata.agent}</span>
          </div>

          <span className="text-[10px] text-muted-foreground/50">|</span>

          {/* Time */}
          <div className="flex items-center gap-1">
            <Clock className="size-3 text-muted-foreground/50" />
            <span className="text-[10px] text-muted-foreground">{timeAgo(asset.metadata.created)}</span>
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
    </button>
  )
}
