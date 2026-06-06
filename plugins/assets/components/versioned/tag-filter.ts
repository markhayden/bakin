/** Shared tag-filter helpers for the grid, folders view, and breadcrumb. */

/** Sentinel tag-filter value matching assets with no tags at all. */
export const UNTAGGED = '__untagged__'

/** Does an asset match the active tag filter (any-of; UNTAGGED = tagless)? */
export function matchesTagFilter(tags: string[], filter: string[]): boolean {
  if (filter.length === 0) return true
  return filter.some((f) => (f === UNTAGGED ? tags.length === 0 : tags.includes(f)))
}
