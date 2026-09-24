import type { NavBadge as NavBadgeData, NavBadgeTone } from '@makinbakin/sdk'
import { StatusMarker, type StatusTone } from '@makinbakin/sdk/patterns'

const MARKER_TONE: Record<NavBadgeTone, StatusTone> = {
  error: 'danger',
  attention: 'attention',
  info: 'success',
  success: 'success',
}

/**
 * Canonical screen-reader word per tone. Single source of truth shared by
 * both aria-suffix builders (the flat one here and the
 * collapsed-parent rollup in nav-badge-logic) so the wording can't diverge
 * per tone as the palette grows.
 */
export const TONE_LABEL: Record<NavBadgeTone, string> = {
  error: 'urgent',
  attention: 'needing review',
  info: 'new updates',
  success: 'new updates',
}

/** Count metadata determines presence; navigation never displays the number. */
export function NavBadge({ badge }: { badge: NavBadgeData | undefined }) {
  if (!badge || (typeof badge.count === 'number' && badge.count <= 0)) return null
  return <StatusMarker data-testid="nav-indicator" size="sm" tone={MARKER_TONE[badge.tone ?? 'attention']} className="ml-auto" />
}

/**
 * Tiny dot overlay used on collapsed parent icons to signal "a child of
 * this group has a badge" without committing to count semantics.
 */
export function NavBadgeDot({ tone }: { tone: NavBadgeTone }) {
  return (
    <StatusMarker
      data-testid="nav-badge-dot"
      size="sm"
      tone={MARKER_TONE[tone]}
      className="absolute right-1 top-1 ring-2 ring-bakin-canvas-default"
    />
  )
}

/**
 * Compose a short suffix to splice into an aria-label so screen readers
 * announce badge state, e.g. "Plans, needing review".
 */
export function navBadgeAriaSuffix(badge: NavBadgeData | undefined): string {
  if (!badge || (typeof badge.count === 'number' && badge.count <= 0)) return ''
  const toneLabel = TONE_LABEL[badge.tone ?? 'attention']
  return `, ${toneLabel}`
}
