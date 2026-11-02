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
 *
 * Column widths are declared, not negotiated (#1040). Under the browser's
 * automatic table layout the snippet's long single line of text out-weighed
 * every title, so Title collapsed to a few characters and broke mid-word
 * while Snippet took the rest of the row. The table is therefore
 * `table-fixed`: Title owns a share of the width, the metadata columns own
 * shares sized to their content at the narrowest table, and Snippet is the
 * one flexible column that absorbs whatever remains — it can shrink, Title
 * cannot. Every share is a fraction of the table (`w-9/25`), the form the
 * design system supports for DataTable column widths (the explore and
 * workflows tables size theirs the same way); raw spacing-scale widths and
 * literal percentage or pixel sizes are legacy style debt.
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
import { Button, Skeleton, SystemState, Text } from '@makinbakin/sdk/ui'
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

/**
 * Column widths under `table-layout: fixed`, as fraction shares of the table:
 * Title's share, content-sized shares for the taxonomy metadata, and the
 * un-sized Snippet column takes the remainder. The metadata shares are sized
 * at the narrowest table each layout renders (below it the list render takes
 * over): the ordinary table's 672px container gives Tier / Agent / Updated
 * 112 / 134 / 112px (a tier badge, an avatar + truncating name, a nowrap
 * "Nov 2, 2026") and leaves Snippet ~72px; wider tables scale every column.
 * The debug-only Score column (global debug + an active query) adds a sixth
 * column the standard budget has no room for, so beside it Title and the
 * metadata each cede a little share, Score takes a share of its own (the
 * overlay stacks its legs — a share keeps it from wrapping into a tall row
 * on a wide screen) and the table hands off to the list one step earlier
 * (a 768px container, where the metadata get 110 / 128 / 110px and Snippet
 * ~83px). Exported so the layout tests pin the contract.
 */
export const MEMORY_COLUMN_WIDTHS = {
  standard: {
    title: 'w-9/25',
    tier: 'w-1/6',
    agent: 'w-1/5',
    updated: 'w-1/6',
  },
  besideScore: {
    title: 'w-8/25',
    tier: 'w-1/7',
    agent: 'w-1/6',
    updated: 'w-1/7',
    score: 'w-3/25',
  },
} as const

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
    const widths = showScoreBreakdown ? MEMORY_COLUMN_WIDTHS.besideScore : MEMORY_COLUMN_WIDTHS.standard
    const base: Array<DataTableColumn<SearchResult, MemorySortField>> = [
      {
        key: 'title',
        header: 'Title',
        sortable: true,
        narrow: 'primary',
        headClassName: widths.title,
        // Words wrap at spaces first and break inside a word only when that
        // word alone is wider than the column (long audit identifiers), two
        // lines at most; the full title stays reachable on the native
        // tooltip and in the record drawer the row opens.
        cellClassName: 'whitespace-normal wrap-break-word',
        cell: (result) => {
          const title = titleOf(result)
          return (
            <span
              data-memory-title=""
              title={title}
              className="line-clamp-2 min-w-0 font-bakin-typography-weight-semibold leading-snug text-bakin-text-primary"
            >
              {title}
            </span>
          )
        },
      },
      {
        key: 'snippet',
        header: 'Snippet',
        narrow: 'meta',
        // The one un-sized column: it takes whatever Title and the metadata
        // leave over, and only ever shows a single clamped line.
        cellClassName: 'whitespace-normal wrap-break-word',
        cell: (result) => {
          const snippet = summarizeSnippet(str(result.fields.snippet), titleOf(result))
          if (!snippet) return null
          return (
            <span
              data-memory-summary=""
              className="line-clamp-1 min-w-0 leading-relaxed text-bakin-text-muted"
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
        narrow: 'meta',
        headClassName: widths.tier,
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
        narrow: 'label',
        headClassName: widths.agent,
        cell: (result) => {
          const agent = str(result.fields.agent)
          if (!agent) return null
          const identity = agentById.get(agent) ?? { id: agent, name: agent }
          return (
            <span className="flex min-w-0 items-center gap-bakin-1">
              <AgentAvatar agent={identity} size="xs" decorative />
              <Text size="meta" tone="muted" className="truncate">
                {identity.name}
              </Text>
            </span>
          )
        },
      },
      {
        key: 'updated',
        header: 'Updated',
        sortable: true,
        narrow: 'label',
        align: 'end',
        headClassName: widths.updated,
        cellClassName: 'whitespace-nowrap',
        cell: (result) => (
          <Text size="meta" tone="muted" className="tabular-nums">
            {formatUpdated(result)}
          </Text>
        ),
      },
    ]

    if (showScoreBreakdown) {
      base.push({
        key: 'score',
        header: 'Score',
        narrow: 'label',
        align: 'end',
        headClassName: MEMORY_COLUMN_WIDTHS.besideScore.score,
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
      collapseBelow={showScoreBreakdown ? '3xl' : '2xl'}
      listVariant="separated"
      columns={columns}
      rows={results}
      rowKey={(result) => result.id}
      rowProps={() => ({ 'data-memory-result': '' })}
      tableProps={{ className: 'table-fixed' }}
      onRowActivate={onSelect ? (result) => onSelect(result) : undefined}
      rowActivateLabel={(result) => `Open ${titleOf(result)}`}
      sort={sort ?? undefined}
      onSortChange={onSortChange}
    />
  )
}
