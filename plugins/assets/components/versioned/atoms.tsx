'use client'

import { FileText, Image, Video, Music, Map, Database, Package, Clock } from 'lucide-react'
import { Badge } from '@makinbakin/sdk/ui'
import { AgentAvatar } from '@makinbakin/sdk/components'
import { formatAge } from '@makinbakin/sdk/utils'
import { assetThumbUrl, assetCurrentUrl } from './asset-urls'

const TYPE_ICONS: Record<string, typeof FileText> = {
  text: FileText, images: Image, video: Video, audio: Music, plans: Map, data: Database, other: Package,
}
const TYPE_COLORS: Record<string, string> = {
  text: 'text-blue-400', images: 'text-emerald-400', video: 'text-purple-400',
  audio: 'text-amber-400', plans: 'text-cyan-400', data: 'text-orange-400', other: 'text-muted-foreground',
}

export function AssetTypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon = TYPE_ICONS[type] || Package
  return <Icon className={`${className ?? 'size-4'} ${TYPE_COLORS[type] || 'text-muted-foreground'}`} />
}

/**
 * Thumbnail for a versioned asset — the image thumb when available, else a
 * type icon. Used by the grid card AND the version-timeline rows.
 */
export function AssetThumb({ assetId, type, version, hasThumb, className }: {
  assetId: string
  type: string
  version?: number
  hasThumb?: boolean
  className?: string
}) {
  const showImage = type === 'images' && hasThumb !== false
  if (showImage) {
    return (
      <img
        src={version != null ? assetThumbUrl(assetId, version) : assetThumbUrl(assetId)}
        alt={assetId}
        className={className ?? 'w-full h-full object-cover'}
        loading="lazy"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
      />
    )
  }
  return (
    <div className={`flex items-center justify-center bg-zinc-900/50 ${className ?? 'w-full h-full'}`}>
      <AssetTypeIcon type={type} className="size-10 opacity-40" />
    </div>
  )
}

/** Agent · age · taskId · tags row. Shared by card, modal, detail header. */
export function AssetMetaSummary({ agent, created, taskId, tags }: {
  agent: string
  created: string
  taskId: string | null
  tags: string[]
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <AgentAvatar agentId={agent} size="xs" />
          <span className="text-[10px] text-muted-foreground">{agent}</span>
        </div>
        <span className="text-[10px] text-muted-foreground/50">|</span>
        <div className="flex items-center gap-1">
          <Clock className="size-3 text-muted-foreground/50" />
          <span className="text-[10px] text-muted-foreground">{formatAge(created)}</span>
        </div>
        {taskId && (
          <>
            <span className="text-[10px] text-muted-foreground/50">|</span>
            <Badge variant="outline" className="text-[9px] h-4 px-1">{taskId.slice(0, 6)}</Badge>
          </>
        )}
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 4).map(tag => (
            <Badge key={tag} variant="secondary" className="text-[9px] h-4 px-1.5">{tag}</Badge>
          ))}
          {tags.length > 4 && <span className="text-[9px] text-muted-foreground">+{tags.length - 4}</span>}
        </div>
      )}
    </div>
  )
}

/** provider · model · routeSource · surface chips for a generated version. */
export function ProvenanceChips({ generation }: {
  generation: { provider: string; model: string; surface: string; routeSource: string } | null
}) {
  if (!generation) return null
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge variant="secondary" className="text-[9px] h-4 px-1.5">{generation.provider}</Badge>
      <Badge variant="secondary" className="text-[9px] h-4 px-1.5">{generation.model}</Badge>
      {generation.surface && generation.surface !== 'custom' && (
        <Badge variant="outline" className="text-[9px] h-4 px-1.5">{generation.surface}</Badge>
      )}
      <Badge
        variant="outline"
        className={`text-[9px] h-4 px-1.5 ${generation.routeSource === 'shim' ? 'text-amber-400' : 'text-emerald-400'}`}
      >
        {generation.routeSource}
      </Badge>
    </div>
  )
}

export { assetCurrentUrl }
