import type { NavBadge as NavBadgeData, NavBadgeTone, NavItem } from '@makinbakin/sdk'
import { navBadgeAriaSuffix, TONE_LABEL } from './nav-badge'

/**
 * Pure decision logic behind nav-badge rendering, extracted from
 * `app-sidebar.tsx` so it can be unit-tested without importing the heavy
 * sidebar component (whose transitive base-ui/lucide import graph currently
 * trips a Bun segfault under the full `--isolate` suite). The sidebar reads
 * these helpers; the JSX wiring is mechanical.
 */

const TONE_PRIORITY: Record<NavBadgeTone, number> = {
  error: 0,
  attention: 1,
  info: 2,
  success: 3,
}

/**
 * A badge counts as "active" when it would actually render — present and
 * not zero-counted. Mirrors the same guard inside the `NavBadge` component
 * so rollup logic agrees with what the user sees.
 */
export function badgeIsActive(badge: NavBadgeData | undefined): badge is NavBadgeData {
  if (!badge) return false
  if (typeof badge.count === 'number' && badge.count <= 0) return false
  return true
}

/** Match the current pathname against an item's href, tolerating undefined hrefs. */
export function isNavActive(pathname: string, href: string | undefined): boolean {
  if (!href) return false
  return pathname === href || pathname.startsWith(href + '/')
}

/**
 * For a parent nav item, pick the most-attention-worthy tone across its
 * direct children that currently have an active badge. Returns null when no
 * child has a badge — caller renders nothing in that case.
 */
export function pickRollupTone(item: NavItem, badges: ReadonlyMap<string, NavBadgeData>): NavBadgeTone | null {
  if (!item.children?.length) return null
  let best: NavBadgeTone | null = null
  for (const child of item.children) {
    const b = badges.get(child.id)
    if (!badgeIsActive(b)) continue
    const tone = b.tone ?? 'attention'
    if (best === null || TONE_PRIORITY[tone] < TONE_PRIORITY[best]) best = tone
  }
  return best
}

/**
 * Tone for the dot shown on a collapsed parent icon. Pick the highest
 * severity across the parent's own active badge and its children. Null → no
 * dot.
 */
export function collapsedParentRollupTone(
  item: NavItem,
  parentBadge: NavBadgeData | undefined,
  badges: ReadonlyMap<string, NavBadgeData>,
): NavBadgeTone | null {
  const parentTone = badgeIsActive(parentBadge) ? (parentBadge.tone ?? 'attention') : null
  const childTone = pickRollupTone(item, badges)
  if (!parentTone) return childTone
  if (!childTone) return parentTone
  return TONE_PRIORITY[parentTone] <= TONE_PRIORITY[childTone] ? parentTone : childTone
}

/**
 * Aria-label suffix for a collapsed parent. When the dot comes from the
 * parent's own badge we announce its count/tone; when a child provides the
 * highest severity we announce that children need attention — otherwise the
 * icon changes silently for screen-reader users.
 */
export function collapsedParentAriaSuffix(
  parentBadge: NavBadgeData | undefined,
  rollupTone: NavBadgeTone | null,
): string {
  if (!rollupTone) return ''
  const parentTone = badgeIsActive(parentBadge) ? (parentBadge.tone ?? 'attention') : null
  if (parentTone === rollupTone) return navBadgeAriaSuffix(parentBadge)
  return `, children ${TONE_LABEL[rollupTone]}`
}
