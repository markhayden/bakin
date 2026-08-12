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
    <article
      className={`relative flex min-w-0 gap-bakin-3 border-t border-bakin-border-subtle px-bakin-2 py-bakin-3 transition-colors ${
        isSelected
          ? 'border-l-2 border-l-bakin-signal-accent bg-bakin-surface-default/70 pl-bakin-3'
          : 'hover:bg-bakin-surface-default/40'
      }`}
      data-testid={`version-row-${version.version}`}
      data-selected={isSelected || undefined}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Preview version ${version.version}`}
        aria-pressed={isSelected}
        className="absolute inset-0 z-0 h-auto min-h-0 min-w-0 w-auto rounded-bakin-surface p-0 hover:bg-transparent"
        onClick={() => onSelect?.(version.version)}
      />

      {canDelete && (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={() => onDelete(version.version)}
          className="absolute right-bakin-2 top-bakin-2 z-20 text-bakin-signal-danger"
          aria-label={`Delete version ${version.version}`}
          data-testid={`delete-version-${version.version}`}
        >
          <Trash2 />
        </Button>
      )}

      <div className="pointer-events-none relative z-10 size-bakin-8 shrink-0 overflow-hidden rounded-bakin-control bg-bakin-surface-default">
        <AssetThumb assetId={assetId} type={assetType} version={version.version} hasThumb={version.thumb !== null} />
      </div>

      <div className="pointer-events-none relative z-10 flex min-w-0 flex-col gap-bakin-2 pr-bakin-8">
        <div className="flex min-w-0 flex-wrap items-center gap-bakin-2">
          <span className="font-bakin-typography-family-mono text-bakin-typography-size-body font-bakin-typography-weight-semibold text-bakin-text-primary">
            v{version.version}
          </span>
          <Badge tone="neutral" variant="soft" size="xs">{version.op}</Badge>
          {isCurrent && (
            <Badge tone="success" variant="solid" size="xs" data-testid="current-badge">current</Badge>
          )}
          <span className="ml-auto text-bakin-typography-size-meta text-bakin-text-muted">
            {formatAge(version.created)}
          </span>
        </div>
        {version.prompt ? (
          <p className="m-0 line-clamp-2 text-bakin-typography-size-meta leading-relaxed text-bakin-text-muted">
            {version.prompt}
          </p>
        ) : null}
        <ProvenanceChips generation={version.generation} />
        {!isCurrent && (
          <div className="pointer-events-auto relative z-20">
            <Button
              type="button"
              size="xs"
              variant="outline"
              aria-label={`Make version ${version.version} current`}
              onClick={() => onPromote(version.version)}
              data-testid={`promote-${version.version}`}
            >
              <Star /> Make current
            </Button>
          </div>
        )}
      </div>
    </article>
  )
}
