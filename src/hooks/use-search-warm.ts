/**
 * useSearchWarm — polls the search query-path warm signal so any search bar can
 * show "warming up" instead of letting users hit cold-compile dead queries on
 * boot. Returns 'cold' | 'warming' | 'warm'. Optimistic: assumes 'warm' until
 * told otherwise (no flicker in the steady state), and stops polling once warm.
 */
import { useEffect, useState } from 'react'

export type SearchWarmState = 'cold' | 'warming' | 'warm'

export function useSearchWarm(): SearchWarmState {
  const [warm, setWarm] = useState<SearchWarmState>('warm')

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      try {
        const res = await fetch('/api/search/warm')
        const data = (await res.json()) as { warm?: SearchWarmState }
        if (cancelled) return
        const state = data?.warm ?? 'warm'
        setWarm(state)
        // Only the boot window keeps polling; once warm we're done.
        if (state !== 'warm') timer = setTimeout(poll, 2000)
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
