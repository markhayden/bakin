/**
 * ?recordId= — URL-addressable memory detail drawer.
 *
 * ⌘K memory hits deep-link to /memory?recordId=<rowId>. Deep links ALWAYS
 * resolve through GET /record (source-of-truth files) — never through rows
 * already on screen: the &q= fallback in the hit href populates the list
 * with the row's stale INDEX copy, and short-circuiting on it would
 * silently open a pruned record and suppress the honest 404 notice. Only
 * open() (an explicit list click on a rendered row) skips the fetch.
 * A miss surfaces an honest error — never a silent fuzzy-search fallback.
 */
import { useMemo, useState } from 'react'
import { usePluginJsonFetch, type SearchResult } from '@makinbakin/sdk/hooks'
import { useQueryState } from '@makinbakin/sdk/navigation'

export interface RecordDeepLink {
  recordId: string
  /** Resolved row for the drawer; null while loading or on a miss. */
  row: SearchResult | null
  /** Honest failure state ("not found", fetch error); null when fine. */
  error: string | null
  /** Open the drawer for a row already in hand (list click). */
  open: (row: SearchResult) => void
  /** Close the drawer (clears the URL param). */
  close: () => void
}

export function useRecordDeepLink(): RecordDeepLink {
  // Push-mode setter for open() — opening a drawer must create a history
  // entry so the back button closes it (same pattern as schedule's jobId).
  const [recordId, setRecordId, pushRecordId] = useQueryState('recordId', '')
  // The row handed to open(). It is the ONLY thing that may stand in for a
  // /record fetch, and only for the exact id it was clicked with.
  const [clicked, setClicked] = useState<SearchResult | null>(null)
  const servedByClick = clicked !== null && clicked.id === recordId

  const { data, error: fetchError } = usePluginJsonFetch<{ result: SearchResult }>(
    'memory',
    recordId && !servedByClick ? `record?id=${encodeURIComponent(recordId)}` : null,
    { timeoutMs: 15_000 },
  )

  // The fetch keeps its last payload while the next one is in flight, so the
  // resolved row is gated on the id matching: record A must never show under
  // ?recordId=B while B resolves.
  const row = servedByClick
    ? clicked
    : data?.result?.id === recordId
      ? data.result
      : null

  const error = useMemo(() => {
    if (!fetchError) return null
    if (/\(404\)/.test(fetchError)) return 'Memory record not found — it may have been pruned.'
    return `Could not load memory record: ${fetchError}`
  }, [fetchError])

  return {
    recordId,
    row,
    error,
    open: (r: SearchResult) => {
      setClicked(r)
      pushRecordId(r.id)
    },
    close: () => setRecordId(''),
  }
}
