'use client'

/**
 * Cross-tier memory results rendered as a low-chrome semantic list.
 *
 * Tier and agent are taxonomy metadata, while the title and snippet carry the
 * content hierarchy. Search relevance stays hidden unless global debug mode
 * explicitly asks for the canonical score overlay.
 */
import { useMemo } from 'react'
import { Bug } from 'lucide-react'
import {
  AgentAvatar,
  ScoreOverlay,
  StatusBadge,
  computeMatchedFields,
  type AgentIdentity,
} from '@makinbakin/sdk/patterns'
import { Button, Card, Skeleton, SystemState } from '@makinbakin/sdk/ui'
import type { SearchResult } from '@makinbakin/sdk/hooks'
import { useDebug } from '@makinbakin/sdk/hooks'
import { tierDisplayName } from './tier-labels'

interface Props {
  results: SearchResult[]
  agents?: readonly AgentIdentity[]
  loading: boolean
  error: string | null
  query: string
  /** When true, the server returned hits but every one was a debug-only tier. */
  hiddenByDebug?: boolean
  /** Callback to flip the page-local Debug toggle from the empty state CTA. */
  onEnableDebug?: () => void
  /** Clears the routed search query from the no-results recovery action. */
  onClear?: () => void
  onSelect?: (result: SearchResult) => void
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function summarizeSnippet(value: string, title: string): string {
  const summary = value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[\s>*+-]+/gm, '')
    .replace(/_/g, ' ')
    .replace(/[#*`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!title || !summary.toLocaleLowerCase().startsWith(title.toLocaleLowerCase())) return summary
  return summary.slice(title.length).replace(/^[\s:–—-]+/, '').trim()
}

export function MemorySearchResults({
  results,
  agents = [],
  loading,
  error,
  query,
  hiddenByDebug,
  onEnableDebug,
  onClear,
  onSelect,
}: Props) {
  const [debug] = useDebug()
  const agentById = useMemo(
    () => new Map(agents.map((item) => [item.id, item])),
    [agents],
  )

  if (loading) {
    return (
      <div className="flex flex-col gap-bakin-2" data-testid="memory-search-results-loading">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-20 w-full" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <SystemState
        kind="error"
        recovery="unavailable"
        scope="section"
        title="Memory could not be loaded"
        description={error}
      />
    )
  }

  const searching = query.trim().length > 0
  const showScoreBreakdown = debug && searching

  if (results.length === 0) {
    if (hiddenByDebug) {
      return (
        <SystemState
          kind="no-results"
          scope="section"
          title="Only system-log matches"
          description={`Every hit for "${query}" is a turn or audit row. Include System Logs to see them.`}
          action={
            onEnableDebug ? (
              <Button size="sm" onClick={onEnableDebug}>
                <Bug />
                Include System Logs
              </Button>
            ) : <Button size="sm" variant="outline" disabled>Include System Logs</Button>
          }
        />
      )
    }

    return searching ? (
      <SystemState
        kind="no-results"
        scope="section"
        title="No memory matches"
        description={`No results for "${query}". Clear the search or adjust the filters.`}
        action={<Button variant="outline" onClick={onClear} disabled={!onClear}>Clear search</Button>}
      />
    ) : (
      <SystemState
        kind="initial-empty"
        scope="section"
        title="No recent memory"
        description="Nothing has been indexed yet, or the current filters exclude every memory record."
      />
    )
  }

  return (
    <ul className="grid gap-bakin-2">
      {results.map((result) => {
        const tier = str(result.fields.tier)
        const agent = str(result.fields.agent)
        const title = str(result.fields.title) || result.id
        const snippet = summarizeSnippet(str(result.fields.snippet), title)
        const clickable = typeof onSelect === 'function'
        const agentIdentity = agent
          ? agentById.get(agent) ?? { id: agent, name: agent }
          : null
        const content = (
          <span className="pointer-events-none relative z-10 grid min-w-0">
            <span className="flex min-w-0 flex-col gap-bakin-2 sm:flex-row sm:items-start sm:justify-between sm:gap-bakin-4">
              <span className="grid min-w-0 gap-bakin-1 sm:flex-1">
                <span className="min-w-0 [overflow-wrap:anywhere] text-bakin-typography-size-body font-bakin-typography-weight-semibold leading-snug text-bakin-text-primary">
                  {title}
                </span>
                {snippet ? (
                  <span
                    data-memory-summary=""
                    className="line-clamp-1 min-w-0 [overflow-wrap:anywhere] text-bakin-typography-size-body leading-relaxed text-bakin-text-muted"
                  >
                    {snippet}
                  </span>
                ) : null}
              </span>
              <span className="flex min-w-0 items-center gap-bakin-2 sm:justify-end">
                <StatusBadge tone="neutral" variant="soft" size="xs">
                  {tierDisplayName(tier)}
                </StatusBadge>
                {agentIdentity ? (
                  <span className="flex min-w-0 items-center gap-bakin-1">
                    <AgentAvatar agent={agentIdentity} size="xs" decorative />
                    <span className="truncate text-bakin-typography-size-meta text-bakin-text-muted">
                      {agentIdentity.name}
                    </span>
                  </span>
                ) : null}
              </span>
            </span>
            {showScoreBreakdown ? (
              <ScoreOverlay
                info={{
                  score: result.score,
                  indexScores: result.indexScores,
                  matchedFields: computeMatchedFields(query, result.fields),
                }}
                className="mt-bakin-1"
              />
            ) : null}
          </span>
        )

        return (
          <li key={result.id}>
            <Card
              size="sm"
              data-memory-result=""
              className="relative gap-0 border-bakin-border-subtle/30 px-bakin-3 transition-colors duration-[var(--bakin-motion-duration-feedback)] hover:border-bakin-border-subtle motion-reduce:transition-none"
            >
              {clickable ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Open ${title}`}
                  className="absolute inset-0 z-0 h-auto w-auto min-h-0 min-w-0 rounded-bakin-surface p-0 hover:bg-transparent"
                  onClick={() => onSelect(result)}
                />
              ) : null}
              {content}
            </Card>
          </li>
        )
      })}
    </ul>
  )
}
