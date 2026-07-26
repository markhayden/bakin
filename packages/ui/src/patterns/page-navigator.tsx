'use client'

import { Button } from '../primitives/button'

export interface PageNavigatorProps {
  page: number
  pageSize: number
  showAll: boolean
  total: number
  ariaLabel?: string
  onPageChange: (page: number) => void
  onShowAllChange: (showAll: boolean) => void
}

/**
 * Compact pagination for long repeated-content regions.
 *
 * The consumer owns URL state and the visible slice so pagination remains
 * shareable, browser-history aware, and independent of domain data fetching.
 */
export function PageNavigator({
  page,
  pageSize,
  showAll,
  total,
  ariaLabel = 'Pagination',
  onPageChange,
  onShowAllChange,
}: PageNavigatorProps) {
  if (total <= pageSize) return null

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(page, 1), pageCount)
  const first = showAll ? 1 : ((safePage - 1) * pageSize) + 1
  const last = showAll ? total : Math.min(safePage * pageSize, total)

  return (
    <nav
      aria-label={ariaLabel}
      data-slot="page-navigator"
      className="flex min-w-0 flex-wrap items-center gap-bakin-2 border-t border-bakin-border-subtle pt-bakin-3"
    >
      <span className="mr-auto text-bakin-typography-size-meta tabular-nums text-bakin-text-muted">
        Showing {first}–{last} of {total}
      </span>
      {!showAll ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={safePage <= 1}
            onClick={() => onPageChange(safePage - 1)}
          >
            Previous
          </Button>
          <span
            aria-label={`Page ${safePage} of ${pageCount}`}
            className="text-bakin-typography-size-meta tabular-nums text-bakin-text-muted"
          >
            {safePage} / {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={safePage >= pageCount}
            onClick={() => onPageChange(safePage + 1)}
          >
            Next
          </Button>
        </>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => onShowAllChange(!showAll)}
      >
        {showAll ? 'Use pages' : 'Show all'}
      </Button>
    </nav>
  )
}
