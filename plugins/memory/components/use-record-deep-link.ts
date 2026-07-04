/**
 * ?recordId= — URL-addressable memory detail drawer.
 *
 * ⌘K memory hits deep-link to /memory?recordId=<rowId>. The hook resolves
 * the id to a full SearchResult: a row already on screen (or just clicked
 * via open()) is used as-is; otherwise GET /record fetches it by rowId.
 * A miss surfaces an honest error — never a silent fuzzy-search fallback.
 */
import { useEffect, useState } from 'react'
import { useQueryState, type SearchResult } from '@makinbakin/sdk/hooks'

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

export function useRecordDeepLink(onScreenRows: SearchResult[]): RecordDeepLink {
  // Push-mode setter for open() — opening a drawer must create a history
  // entry so the back button closes it (same pattern as schedule's jobId).
  const [recordId, setRecordId, pushRecordId] = useQueryState('recordId', '')
  const [row, setRow] = useState<SearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!recordId) {
      setRow(null)
      setError(null)
      return
    }
    if (row?.id === recordId) return
    // Never show record A's content under ?recordId=B while B resolves.
    setRow(null)
    const onScreen = onScreenRows.find((r) => r.id === recordId)
    if (onScreen) {
      setRow(onScreen)
      setError(null)
      return
    }
    const controller = new AbortController()
    fetch(`/api/plugins/memory/record?id=${encodeURIComponent(recordId)}`, { signal: controller.signal })
      .then(async (res) => {
        if (res.status === 404) {
          setRow(null)
          setError('Memory record not found — it may have been pruned.')
          return
        }
        if (!res.ok) throw new Error(`record: ${res.status}`)
        const data = (await res.json()) as { result: SearchResult }
        setRow(data.result)
        setError(null)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setRow(null)
        setError(`Could not load memory record: ${err instanceof Error ? err.message : String(err)}`)
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, onScreenRows])

  return {
    recordId,
    row,
    error,
    open: (r: SearchResult) => {
      setRow(r)
      setError(null)
      pushRecordId(r.id)
    },
    close: () => setRecordId(''),
  }
}
