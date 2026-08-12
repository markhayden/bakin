'use client'

import { useEffect, useMemo, useState } from 'react'
import { FileText, Image, Video, Music, Map, Database, Package, Clock } from 'lucide-react'
import { useAgent } from '@makinbakin/sdk/hooks'
import { AgentAvatar } from '@makinbakin/sdk/patterns'
import { Badge } from '@makinbakin/sdk/ui'
import { formatAge } from '@makinbakin/sdk/utils'
import { assetThumbUrl, assetCurrentUrl, assetVersionUrl } from './asset-urls'

const TYPE_ICONS: Record<string, typeof FileText> = {
  text: FileText, images: Image, video: Video, audio: Music, plans: Map, data: Database, other: Package,
}

/**
 * Type identity is carried by the icon GLYPH, not a color code — the per-type
 * raw palette was neutralized for parity with the global-search overlay
 * treatment (storybook refit T6.2/T6.5).
 */
export function AssetTypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon = TYPE_ICONS[type] || Package
  return <Icon className={`${className ?? 'size-bakin-4'} text-bakin-text-muted`} />
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
  const imageSrc = useMemo(() => {
    if (type !== 'images') return null
    if (hasThumb !== false) return version != null ? assetThumbUrl(assetId, version) : assetThumbUrl(assetId)
    return version != null ? assetVersionUrl(assetId, version) : assetCurrentUrl(assetId)
  }, [assetId, hasThumb, type, version])
  const [failed, setFailed] = useState(false)

  useEffect(() => { setFailed(false) }, [imageSrc])

  if (imageSrc && !failed) {
    return (
      <img
        src={imageSrc}
        alt={assetId}
        className={className ?? 'w-full h-full object-cover'}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <div className={`flex items-center justify-center bg-bakin-surface-default ${className ?? 'w-full h-full'}`}>
      <AssetTypeIcon type={type} className="size-bakin-8 opacity-40" />
    </div>
  )
}

/** Avatar + name for the owning agent, resolved from the roster. */
function AssetAgentIdentity({ agentId }: { agentId: string }) {
  const agent = useAgent(agentId)
  return (
    <div className="flex items-center gap-bakin-1">
      <AgentAvatar
        agent={{ id: agentId, name: agent?.name ?? agentId, imageSrc: agent?.headshot ?? null }}
        size="xs"
        decorative
      />
      <span className="text-bakin-typography-size-meta text-bakin-text-muted">{agentId}</span>
    </div>
  )
}

/**
 * Agent · age · taskId · tags row. Shared by card, modal, detail header.
 * `maxTags` caps the badges (cards stay compact, "+N" shows the rest);
 * the detail view passes Infinity — truncating there hid freshly added
 * tags behind the overflow counter.
 */
export function AssetMetaSummary({ agent, created, taskId, tags, maxTags = 4 }: {
  agent: string
  created: string
  taskId: string | null
  tags: string[]
  maxTags?: number
}) {
  return (
    <div className="flex flex-col gap-bakin-1">
      <div className="flex items-center gap-bakin-2">
        <AssetAgentIdentity agentId={agent} />
        <span className="text-bakin-typography-size-meta text-bakin-text-muted/50">|</span>
        <div className="flex items-center gap-bakin-1">
          <Clock className="size-bakin-3 text-bakin-text-muted/50" />
          <span className="text-bakin-typography-size-meta text-bakin-text-muted">{formatAge(created)}</span>
        </div>
        {taskId && (
          <>
            <span className="text-bakin-typography-size-meta text-bakin-text-muted/50">|</span>
            <Badge variant="outline" size="xs">{taskId.slice(0, 6)}</Badge>
          </>
        )}
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-bakin-1">
          {/* Most-recent tags win the cap — tags append chronologically, so a
              freshly added tag must be visible, not hidden behind "+N". */}
          {tags.slice(-maxTags).map(tag => (
            <Badge key={tag} variant="secondary" size="xs">{tag}</Badge>
          ))}
          {tags.length > maxTags && <span className="text-bakin-typography-size-meta text-bakin-text-muted">+{tags.length - maxTags}</span>}
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
    <div className="flex flex-wrap items-center gap-bakin-1">
      <Badge variant="secondary" size="xs">{generation.provider}</Badge>
      <Badge variant="secondary" size="xs">{generation.model}</Badge>
      {generation.surface && generation.surface !== 'custom' && (
        <Badge variant="outline" size="xs">{generation.surface}</Badge>
      )}
      <Badge
        variant="outline"
        size="xs"
        tone={generation.routeSource === 'shim' ? 'attention' : 'neutral'}
      >
        {generation.routeSource}
      </Badge>
    </div>
  )
}

export { assetCurrentUrl }
