import type { NavBadge as NavBadgeData, NavBadgeTone } from '@makinbakin/sdk'
import { Badge, type BadgeTone } from '@makinbakin/sdk/ui'
import { StatusMarker, type StatusTone } from '@makinbakin/sdk/patterns'

const BADGE_TONE: Record<NavBadgeTone, BadgeTone> = {
  error: 'danger',
  attention: 'attention',
  info: 'info',
  success: 'success',
}

/**
 * Presence-only dots ride the kit StatusMarker, whose tone vocabulary has no
 * `info` member — `accent` is the marker's informational signal colour.
 */
const MARKER_TONE: Record<NavBadgeTone, StatusTone> = {
  error: 'danger',
  attention: 'attention',
  info: 'accent',
  success: 'success',
}

/**
 * Canonical screen-reader word per tone. Single source of truth shared by
 * both aria-suffix builders (the flat/counted one here and the
 * collapsed-parent rollup in nav-badge-logic) so the wording can't diverge
 * per tone as the palette grows.
 */
export const TONE_LABEL: Record<NavBadgeTone, string> = {
  error: 'urgent',
  attention: 'needing review',
  info: 'info',
  success: 'success',
}

function formatCount(n: number): string {
  return n > 99 ? '99+' : String(n)
}

/**
 * Inline badge for a nav-item label. Renders a small pill when the badge
 * has a count, or a small inline dot when the badge is presence-only.
 * Returns null for missing badges or `count: 0` so it's safe to drop into
 * any nav-item render path unconditionally.
 */
export function NavBadge({ badge }: { badge: NavBadgeData | undefined }) {
  if (!badge) return null
  const tone = badge.tone ?? 'attention'
  if (typeof badge.count === 'number') {
    if (badge.count <= 0) return null
    return (
      <Badge
        data-testid="nav-badge-pill"
        tone={BADGE_TONE[tone]}
        variant="solid"
        size="xs"
        className="ml-auto"
      >
        {formatCount(badge.count)}
      </Badge>
    )
  }
  // Unlabelled on purpose: the nav link's aria-label carries the badge
  // state via navBadgeAriaSuffix, so the marker stays decorative.
  return <StatusMarker data-testid="nav-badge-pill" tone={MARKER_TONE[tone]} className="ml-auto" />
}

/**
 * Tiny dot overlay used on collapsed parent icons to signal "a child of
 * this group has a badge" without committing to count semantics.
 */
export function NavBadgeDot({ tone }: { tone: NavBadgeTone }) {
  return (
    <StatusMarker
      data-testid="nav-badge-dot"
      tone={MARKER_TONE[tone]}
      className="absolute right-1 top-1 ring-2 ring-bakin-canvas-default"
    />
  )
}

/**
 * Compose a short suffix to splice into an aria-label so screen readers
 * announce badge state, e.g. "Plans, 3 needing review".
 */
export function navBadgeAriaSuffix(badge: NavBadgeData | undefined): string {
  if (!badge || (typeof badge.count === 'number' && badge.count <= 0)) return ''
  const toneLabel = TONE_LABEL[badge.tone ?? 'attention']
  if (typeof badge.count === 'number') return `, ${formatCount(badge.count)} ${toneLabel}`
  return `, ${toneLabel}`
}
