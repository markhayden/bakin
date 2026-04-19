'use client'

/**
 * MemorySearchResults — cross-tier result list for the /memory page.
 *
 * Renders rows from the unified `bakin_memory` table — either search
 * results (when `query` is non-empty) or the /recent feed (when `query`
 * is empty). Each row surfaces the tier badge (the whole point of
 * cross-tier search), the owning agent, title, snippet, and score.
 * Callers pass in the merged result set plus the active query; the
 * component handles its own loading / error / empty states.
 */
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/error-banner'
import { EmptyState } from '@/components/empty-state'
import { Search, Clock, Bug } from 'lucide-react'
import type { SearchResult } from '@/hooks/use-search'
import { useDebug } from '@/hooks/use-debug'
import { tierStyle } from './tier-colors'

interface Props {
  results: SearchResult[]
  loading: boolean
  error: string | null
  query: string
  /** When true, the server returned hits but every one was a debug-only tier. */
  hiddenByDebug?: boolean
  /** Callback to flip the page-local Debug toggle from the empty state CTA. */
  onEnableDebug?: () => void
  onSelect?: (result: SearchResult) => void
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function formatScore(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '—'
}

export function MemorySearchResults({
  results,
  loading,
  error,
  query,
  hiddenByDebug,
  onEnableDebug,
  onSelect,
}: Props) {
  const [debug] = useDebug()

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

  const searching = query.trim().length > 0
  const showScoreBreakdown = debug && searching

  if (results.length === 0) {
    if (hiddenByDebug) {
      return (
        <EmptyState
          icon={Bug}
          title="Only debug-tier matches"
          description={`Every hit for "${query}" is a turn or audit row. Enable Debug to see them.`}
          action={
            onEnableDebug ? (
              <Button size="sm" onClick={onEnableDebug} className="gap-1.5">
                <Bug className="size-3.5" />
                Enable Debug
              </Button>
            ) : undefined
          }
        />
      )
    }
    return searching ? (
      <EmptyState
        icon={Search}
        title="No results"
        description={`No results for "${query}"`}
      />
    ) : (
      <EmptyState
        icon={Clock}
        title="No recent activity"
        description="Nothing has been indexed yet, or your filters exclude everything. Try toggling Debug to include turns and audit entries."
      />
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
        const style = tierStyle(tier)

        return (
          <li key={r.id}>
            <Card
              className={
                'flex flex-col gap-2 p-4 border-l-4 transition-colors ' +
                style.accent +
                (clickable ? ' cursor-pointer ' + style.bg : '')
              }
              onClick={clickable ? () => onSelect!(r) : undefined}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant="outline"
                  className={`text-[10px] uppercase tracking-wide ${style.badge}`}
                >
                  {style.label}
                </Badge>
                {agent && (
                  <Badge variant="secondary" className="text-[10px]">
                    {agent}
                  </Badge>
                )}
                <div className="ml-auto flex items-center gap-2 font-mono text-[10px] shrink-0">
                  {showScoreBreakdown ? (
                    <ScoreBreakdown result={r} />
                  ) : (
                    <span className="text-xs text-muted-foreground">{formatScore(r.score)}</span>
                  )}
                </div>
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

/**
 * Per-result score breakdown overlay — matches the pattern used on the
 * messaging session list and asset cards. RRF is the merged rank, SEM is
 * the `embeddings` semantic index, BM25 is whichever full-text index key
 * Antfly attached (Bleve's key is an absolute filesystem path containing
 * "bleve", so it can't be hardcoded).
 */
function ScoreBreakdown({ result }: { result: SearchResult }) {
  const scores = result.indexScores ?? {}
  const semKey = 'embeddings'
  const bm25Key = Object.keys(scores).find(
    (k) => k !== semKey && /bleve|full_text/.test(k),
  ) ?? Object.keys(scores).find((k) => k !== semKey)
  const bm25 = bm25Key !== undefined ? scores[bm25Key] : undefined
  const sem = scores[semKey]
  return (
    <>
      <span className="text-amber-400">RRF {formatScore(result.score)}</span>
      <span className="text-cyan-400">BM25 {bm25 !== undefined ? bm25.toFixed(3) : '—'}</span>
      <span className="text-purple-400">SEM {sem !== undefined ? sem.toFixed(3) : '—'}</span>
    </>
  )
}
