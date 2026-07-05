// Pure nav partition logic, kept lucide/router-free for testability
// (same pattern as nav-badge-logic.ts).
import type { NavItem } from '@makinbakin/sdk'

export interface PartitionedNavItems {
  main: NavItem[]
  bottom: NavItem[]
}

/**
 * Split top-level nav items into the main scrolling list and the
 * bottom-pinned section (rendered above Settings). Placement is a
 * top-level concern only — children are never partitioned.
 */
export function partitionNavItems(items: readonly NavItem[]): PartitionedNavItems {
  const main: NavItem[] = []
  const bottom: NavItem[] = []
  for (const item of items) {
    if (item.placement === 'bottom') bottom.push(item)
    else main.push(item)
  }
  return { main, bottom }
}
