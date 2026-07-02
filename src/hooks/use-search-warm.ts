/**
 * useSearchWarm — polls the search query-path warm signal so any search bar can
 * show "warming up" instead of letting users hit cold-compile dead queries on
 * boot. Returns 'cold' | 'warming' | 'warm'. Optimistic: assumes 'warm' until
 * told otherwise (no flicker in the steady state), and stops polling once warm.
 */
import { useEffect, useState } from 'react'

export type SearchWarmState = 'cold' | 'warming' | 'warm'

const POLL_MS = 2000
// The warm-up self-terminates server-side within ~90s. If the signal still
// isn't warm well past that (search bootstrap wedged, adapter down), stop
// polling and fail open — the indicator is boot-window UX, not a health page.
const MAX_POLL_MS = 3 * 60_000

export function useSearchWarm(): SearchWarmState {
  const [warm, setWarm] = useState<SearchWarmState>('warm')

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const startedAt = Date.now()

    const poll = async () => {
      try {
        const res = await fetch('/api/search/warm')
        const data = (await res.json()) as { warm?: SearchWarmState }
        if (cancelled) return
        const state = data?.warm ?? 'warm'
        if (state !== 'warm' && Date.now() - startedAt >= MAX_POLL_MS) {
          setWarm('warm')
          return
        }
        setWarm(state)
        // Only the boot window keeps polling; once warm we're done.
        if (state !== 'warm') timer = setTimeout(poll, POLL_MS)
      } catch {
        // Never block search on a transient fetch error — assume warm.
        if (!cancelled) setWarm('warm')
      }
    }
    poll()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  return warm
}
