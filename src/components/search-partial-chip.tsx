'use client'

/**
 * Honest partial-results indicator (spec D11 / search-trust-and-speed SD3).
 * Rendered by every search surface when the response says a source missed
 * its query budget — degraded to keyword-only or omitted entirely. The
 * tooltip names the sources so slowness is never anonymous.
 */
import { AlertTriangle } from 'lucide-react'

export interface SearchPartialMeta {
  partial?: boolean
  tables?: Array<{ table: string; hits: number; took_ms: number; budget?: 'degraded' | 'omitted' }>
}

const BUDGET_LABEL: Record<'degraded' | 'omitted', string> = {
  degraded: 'keyword-only',
  omitted: 'no answer in time',
}

export function SearchPartialChip({ meta, className = '' }: { meta: SearchPartialMeta | null | undefined; className?: string }) {
  if (!meta?.partial) return null
  const slow = (meta.tables ?? []).filter((t) => t.budget !== undefined)
  const detail = slow
    .map((t) => `${t.table.replace(/^bakin_/, '')}: ${BUDGET_LABEL[t.budget!]} (${t.took_ms}ms)`)
    .join('\n')
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400 ${className}`}
      title={detail.length > 0 ? `Some sources missed the search budget:\n${detail}` : 'Some sources missed the search budget'}
      data-testid="search-partial-chip"
    >
      <AlertTriangle className="size-3" />
      Partial results
    </span>
  )
}
