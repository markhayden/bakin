'use client'

/**
 * MemorySearchResults — cross-tier result list for /memory/search.
 *
 * Renders rows from the unified `bakin_memory` table. Each row surfaces the
 * tier badge (the whole point of cross-tier search), the owning agent,
 * title, snippet, and relevance score. Callers pass in `useSearch` output
 * plus the active query; the component handles its own loading / error /
 * empty states.
 */
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/error-banner'
import type { SearchResult } from '@/hooks/use-search'

interface Props {
  results: SearchResult[]
  loading: boolean
  error: string | null
  query: string
  onSelect?: (result: SearchResult) => void
}

const TIER_LABELS: Record<string, string> = {
  session: 'Session',
  turn: 'Turn',
  checkpoint: 'Checkpoint',
  daily_note: 'Daily Note',
  dream: 'Dream',
  durable: 'Durable',
  audit: 'Audit',
}

function tierLabel(raw: unknown): string {
  if (typeof raw !== 'string') return 'Unknown'
  return TIER_LABELS[raw] ?? raw
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function formatScore(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '—'
}

export function MemorySearchResults({ results, loading, error, query, onSelect }: Props) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2" data-testid="memory-search-results-loading">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    )
  }

  if (error) {
    return <ErrorBanner message={`Search failed: ${error}`} />
  }

  if (!query.trim()) {
    return null
  }

  if (results.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-muted-foreground/30 px-4 py-8 text-center text-sm text-muted-foreground">
        No results for <span className="font-mono">{query}</span>.
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {results.map((r) => {
        const tier = str(r.fields.tier)
        const agent = str(r.fields.agent)
        const title = str(r.fields.title) || r.id
        const snippet = str(r.fields.snippet)
        const clickable = typeof onSelect === 'function'

        return (
          <li key={r.id}>
            <Card
              className={
                'flex flex-col gap-2 p-4' +
                (clickable ? ' cursor-pointer hover:bg-muted/40 transition-colors' : '')
              }
              onClick={clickable ? () => onSelect!(r) : undefined}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                  {tierLabel(tier)}
                </Badge>
                {agent && (
                  <Badge variant="secondary" className="text-[10px]">
                    {agent}
                  </Badge>
                )}
                <span className="text-xs font-mono text-muted-foreground ml-auto">
                  {formatScore(r.score)}
                </span>
              </div>

              <div className="text-sm font-medium leading-snug">{title}</div>

              {snippet && (
                <div className="text-xs text-muted-foreground line-clamp-2">{snippet}</div>
              )}
            </Card>
          </li>
        )
      })}
    </ul>
  )
}
