'use client'

/**
 * Cross-tier memory results rendered as a comparable-record table.
 *
 * Tier, agent, and last-updated are taxonomy metadata that read as columns;
 * title and snippet carry the content hierarchy. Search relevance stays hidden
 * unless global debug mode explicitly asks for the canonical score column.
 *
 * Ordering note: `results` is the page slice memory-shell already paginated,
 * Sort is controlled by the shell, which holds the full result set and slices
 * it into pages — sorting here would reorder only the visible page while the
 * table announced a global sort.
 */
import { useMemo } from 'react'
import { Bug } from 'lucide-react'
import {
  AgentAvatar,
  DataTable,
  ScoreOverlay,
  StatusBadge,
  computeMatchedFields,
  type AgentIdentity,
  type DataTableColumn,
  type DataTableSort,
} from '@makinbakin/sdk/patterns'
import { Button, Skeleton, SystemState } from '@makinbakin/sdk/ui'
import type { SearchResult } from '@makinbakin/sdk/hooks'
import { useDebug } from '@makinbakin/sdk/hooks'
import { tierDisplayName } from './tier-labels'

/** Sort keys the taxonomy columns expose. */
export type MemorySortField = 'title' | 'tier' | 'agent' | 'updated'

interface Props {
  results: SearchResult[]
  /**
   * Sort is owned by the shell because the shell holds the FULL result set and
   * slices it into pages. Sorting here would reorder only the visible page
   * while DataTable announced a global sort.
   */
  sort?: DataTableSort<MemorySortField> | null
  onSortChange?: (field: MemorySortField) => void
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

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function titleOf(result: SearchResult): string {
  return str(result.fields.title) || result.id
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

/** `updated_at` is epoch ms on the wire; missing values sort last. */
function updatedMs(result: SearchResult): number | null {
  // `updated_at` is epoch milliseconds (lib/types.ts: `updatedAt: z.number()`),
  // so reading it as a string left the column permanently em-dashed and its
  // sort a no-op. The sibling detail drawer already reads it as a number.
  return numOrNull(result.fields.updated_at)
}

function formatUpdated(result: SearchResult): string {
  const ms = updatedMs(result)
  if (ms === null) return '—'
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function memorySortValue(result: SearchResult, field: MemorySortField): string | number | null {
  if (field === 'title') return titleOf(result).toLocaleLowerCase()
  if (field === 'tier') return tierDisplayName(str(result.fields.tier)).toLocaleLowerCase()
  if (field === 'agent') return str(result.fields.agent).toLocaleLowerCase()
  return updatedMs(result)
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
  sort,
  onSortChange,
}: Props) {
  const [debug] = useDebug()
  const agentById = useMemo(
    () => new Map(agents.map((item) => [item.id, item])),
    [agents],
  )

  const searching = query.trim().length > 0
  const showScoreBreakdown = debug && searching

  const columns = useMemo<ReadonlyArray<DataTableColumn<SearchResult, MemorySortField>>>(() => {
    const base: Array<DataTableColumn<SearchResult, MemorySortField>> = [
      {
        key: 'title',
        header: 'Title',
        sortable: true,
        headClassName: 'min-w-48',
        cellClassName: 'whitespace-normal',
        cell: (result) => (
          <span className="min-w-0 [overflow-wrap:anywhere] font-bakin-typography-weight-semibold leading-snug text-bakin-text-primary">
            {titleOf(result)}
          </span>
        ),
      },
      {
        key: 'snippet',
        header: 'Snippet',
        headClassName: 'min-w-64',
        cellClassName: 'whitespace-normal',
        cell: (result) => {
          const snippet = summarizeSnippet(str(result.fields.snippet), titleOf(result))
          if (!snippet) return null
          return (
            <span
              data-memory-summary=""
              className="line-clamp-1 min-w-0 [overflow-wrap:anywhere] leading-relaxed text-bakin-text-muted"
            >
              {snippet}
            </span>
          )
        },
      },
      {
        key: 'tier',
        header: 'Tier',
        sortable: true,
        cell: (result) => (
          <StatusBadge tone="neutral" variant="soft" size="xs">
            {tierDisplayName(str(result.fields.tier))}
          </StatusBadge>
        ),
      },
      {
        key: 'agent',
        header: 'Agent',
        sortable: true,
        cell: (result) => {
          const agent = str(result.fields.agent)
          if (!agent) return null
          const identity = agentById.get(agent) ?? { id: agent, name: agent }
          return (
            <span className="flex min-w-0 items-center gap-bakin-1">
              <AgentAvatar agent={identity} size="xs" decorative />
              <span className="truncate text-bakin-typography-size-meta text-bakin-text-muted">
                {identity.name}
              </span>
            </span>
          )
        },
      },
      {
        key: 'updated',
        header: 'Updated',
        sortable: true,
        align: 'end',
        cell: (result) => (
          <span className="tabular-nums text-bakin-typography-size-meta text-bakin-text-muted">
            {formatUpdated(result)}
          </span>
        ),
      },
    ]

    if (showScoreBreakdown) {
      base.push({
        key: 'score',
        header: 'Score',
        align: 'end',
        cellClassName: 'whitespace-normal',
        cell: (result) => (
          <ScoreOverlay
            info={{
              score: result.score,
              indexScores: result.indexScores,
              matchedFields: computeMatchedFields(query, result.fields),
            }}
          />
        ),
      })
    }

    return base
  }, [agentById, query, showScoreBreakdown])

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
    <DataTable
      label="Memory results"
      columns={columns}
      rows={results}
      rowKey={(result) => result.id}
      rowProps={() => ({ 'data-memory-result': '' })}
      onRowActivate={onSelect ? (result) => onSelect(result) : undefined}
      rowActivateLabel={(result) => `Open ${titleOf(result)}`}
      sort={sort ?? undefined}
      onSortChange={onSortChange}
    />
  )
}
