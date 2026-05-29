import type { NavBadge as NavBadgeData, NavBadgeTone } from '@makinbakin/sdk'

const PILL_TONE: Record<NavBadgeTone, string> = {
  error: 'bg-red-500/20 text-red-300',
  attention: 'bg-amber-500/20 text-amber-300',
  info: 'bg-sky-500/20 text-sky-300',
  success: 'bg-emerald-500/20 text-emerald-300',
}

const DOT_TONE: Record<NavBadgeTone, string> = {
  error: 'bg-red-400',
  attention: 'bg-amber-400',
  info: 'bg-sky-400',
  success: 'bg-emerald-400',
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
      <span
        data-testid="nav-badge-pill"
        className={`ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium leading-none ${PILL_TONE[tone]}`}
      >
        {formatCount(badge.count)}
      </span>
    )
  }
  return (
    <span
      data-testid="nav-badge-pill"
      className={`ml-auto inline-block size-1.5 rounded-full ${DOT_TONE[tone]}`}
    />
  )
}

/**
 * Tiny dot overlay used on collapsed parent icons to signal "a child of
 * this group has a badge" without committing to count semantics.
 */
export function NavBadgeDot({ tone }: { tone: NavBadgeTone }) {
  return (
    <span
      data-testid="nav-badge-dot"
      aria-hidden="true"
      className={`absolute right-1 top-1 size-1.5 rounded-full ring-2 ring-background ${DOT_TONE[tone]}`}
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
