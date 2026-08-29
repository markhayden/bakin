'use client'

import { Badge, Button, Card, Text } from '@makinbakin/sdk/ui'
import { formatAge } from '@makinbakin/sdk/utils'
import { Star, Trash2 } from 'lucide-react'
import { AssetThumb, ProvenanceChips } from './atoms'
import type { AssetVersion } from './types'
import { Inline } from '@makinbakin/sdk/layout'

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
    // Card (not ListRow): the parent stacks rows in a plain div, and a
    // ListRow's <li> needs a ListRows parent. The whole-surface activation
    // rides the kit interactive contract; `render` carries aria-pressed so
    // the preview stays a real toggle button.
    <Card
      size="sm"
      selected={isSelected}
      interactive={{
        label: `Preview version ${version.version}`,
        render: (
          <button
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect?.(version.version)}
          />
        ),
      }}
      className="flex-row px-bakin-2"
      data-testid={`version-row-${version.version}`}
      data-selected={isSelected || undefined}
    >
      {canDelete && (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={() => onDelete(version.version)}
          className="absolute right-bakin-2 top-bakin-2 text-bakin-signal-danger"
          aria-label={`Delete version ${version.version}`}
          data-testid={`delete-version-${version.version}`}
        >
          <Trash2 />
        </Button>
      )}

      <div className="size-bakin-8 shrink-0 overflow-hidden rounded-bakin-control bg-bakin-surface-default">
        <AssetThumb assetId={assetId} type={assetType} version={version.version} hasThumb={version.thumb !== null} />
      </div>

      <div className="flex min-w-0 flex-col gap-bakin-2 pr-bakin-8">
        <Inline gap="dense">
          <Text size="body" weight="semibold" mono>
            v{version.version}
          </Text>
          <Badge tone="neutral" variant="soft" size="xs">{version.op}</Badge>
          {isCurrent && (
            <Badge tone="success" variant="solid" size="xs" data-testid="current-badge">current</Badge>
          )}
          <Text size="meta" tone="muted" className="ml-auto">
            {formatAge(version.created)}
          </Text>
        </Inline>
        {version.prompt ? (
          <Text size="meta" tone="muted" as="p" className="line-clamp-2 leading-relaxed">
            {version.prompt}
          </Text>
        ) : null}
        <ProvenanceChips generation={version.generation} />
        {!isCurrent && (
          <div>
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
    </Card>
  )
}
