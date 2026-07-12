'use client'

/**
 * Honest engine-down inline chip (spec D11 / search-trust-and-speed WS6).
 *
 * For surfaces that keep a client-side substring fallback so browsing still
 * works while the engine is down (tasks board, schedule, workflows). The
 * fallback itself is fine — silently pretending it is real search is not.
 * Render this chip next to the search input whenever a query is active and
 * `useSearch().status === 'unavailable'`. Surfaces with no fallback render
 * the full `SearchUnavailable` panel instead.
 */
import { AlertTriangle } from 'lucide-react'

export function SearchDegradedChip({ testId = 'search-degraded', className = '' }: { testId?: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400 ${className}`}
      title="The search engine is not responding. Results are filtered by basic text matching until it recovers."
      data-testid={testId}
    >
      <AlertTriangle className="size-3" />
      Search is unavailable — showing basic text matching
    </span>
  )
}
