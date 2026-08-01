'use client'

import { StatusBadge, type StatusTone } from '@makinbakin/sdk/patterns'

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
  dot: string
  tip: string
}> = {
  absent: {
    label: 'absent',
    tone: 'neutral',
    dot: 'bg-bakin-text-muted',
    tip: 'No runtime entry and no package tracking.',
  },
  unmanaged: {
    label: 'unmanaged',
    tone: 'neutral',
    dot: 'bg-bakin-text-muted',
    tip: 'This runtime agent is not tracked by a Bakin package.',
  },
  managed: {
    label: 'managed',
    tone: 'success',
    dot: 'bg-bakin-action-primary-background',
    tip: 'Bakin manages this agent package and its projected workspace files.',
  },
  drifted: {
    label: 'drifted',
    tone: 'attention',
    dot: 'bg-bakin-signal-highlight',
    tip: 'Projected files no longer match the recorded package state.',
  },
  'update-available': {
    label: 'update available',
    tone: 'accent',
    dot: 'bg-bakin-signal-accent',
    tip: 'A newer version of the source package is available.',
  },
}

export function PackageStateBadge({ state, packageId, title, compact }: PackageStateBadgeProps) {
  const presentation = STATE_PRESENTATION[state]
  const tooltip = title ?? presentation.tip

  if (compact) {
    return (
      <span
        title={`${presentation.label} — ${tooltip}`}
        aria-label={`Package state: ${presentation.label}`}
        data-state={state}
        className={`inline-block size-bakin-2 shrink-0 rounded-bakin-pill ${presentation.dot}`}
      />
    )
  }

  return (
    <span title={tooltip} className="inline-flex min-w-0 flex-wrap items-center gap-bakin-2">
      <StatusBadge tone={presentation.tone} variant="solid" size="xs">
        {presentation.label}
      </StatusBadge>
      {packageId && state !== 'unmanaged' && state !== 'absent' ? (
        <code className="break-all font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
          {packageId}
        </code>
      ) : null}
    </span>
  )
}
