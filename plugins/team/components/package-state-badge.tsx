'use client'

import { StatusBadge, StatusMarker, type StatusTone } from '@makinbakin/sdk/patterns'
import { Text, Tooltip, TooltipContent, TooltipTrigger } from '@makinbakin/sdk/ui'

export type PackageState =
  | 'absent'
  | 'unmanaged'
  | 'managed'
  | 'drifted'
  | 'update-available'

export interface PackageStateBadgeProps {
  state: PackageState
  packageId?: string
  title?: string
  compact?: boolean
}

const STATE_PRESENTATION: Record<PackageState, {
  label: string
  tone: StatusTone
  tip: string
}> = {
  absent: {
    label: 'absent',
    tone: 'neutral',
    tip: 'No runtime entry and no package tracking.',
  },
  unmanaged: {
    label: 'unmanaged',
    tone: 'neutral',
    tip: 'This runtime agent is not tracked by a Bakin package.',
  },
  managed: {
    label: 'managed',
    tone: 'success',
    tip: 'Bakin manages this agent package and its projected workspace files.',
  },
  drifted: {
    label: 'drifted',
    tone: 'attention',
    tip: 'Projected files no longer match the recorded package state.',
  },
  'update-available': {
    label: 'update available',
    tone: 'accent',
    tip: 'A newer version of the source package is available.',
  },
}

export function PackageStateBadge({ state, packageId, title, compact }: PackageStateBadgeProps) {
  const presentation = STATE_PRESENTATION[state]
  const tooltip = title ?? presentation.tip

  if (compact) {
    // What a package state MEANS is explanatory copy, not screen-reader-only
    // text: hiding it from sighted users inverts the accessibility direction.
    return (
      <Tooltip>
        <TooltipTrigger render={<span />} className="inline-flex shrink-0 items-center">
          <StatusMarker
            tone={presentation.tone}
            label={`Package state: ${presentation.label}`}
            data-state={state}
          />
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-bakin-2">
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <StatusBadge tone={presentation.tone} variant="solid" size="xs">
            {presentation.label}
          </StatusBadge>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
      {packageId && state !== 'unmanaged' && state !== 'absent' ? (
        <Text size="meta" tone="muted" mono as="code" className="break-all">
          {packageId}
        </Text>
      ) : null}
    </span>
  )
}
