import { useEffect, useRef } from 'react'
import { useJsonFetch, usePluginEvent } from '@makinbakin/sdk/hooks'

/**
 * How many "Do more with Bakin" suggestions apply to this home, for the
 * sidebar's card. Home's state route is the one answer; this never counts
 * anything itself. It looks again when the page changes (something may
 * have been installed on the last one) and when a suggestion is put away
 * in any browser. Zero until it is known, and zero when it cannot be.
 */
export function useSuggestionCount(pathname: string): number {
  const { data, refresh } = useJsonFetch<{ suggestions?: unknown }>('/api/plugins/home/state')
  usePluginEvent('home.suggestions_changed', refresh)
  const seen = useRef(pathname)
  useEffect(() => {
    if (seen.current === pathname) return
    seen.current = pathname
    refresh()
  }, [pathname, refresh])
  // What Home lists, not everything that applies: the count is a promise about what is on the other end of the link.
  return Array.isArray(data?.suggestions) ? data.suggestions.length : 0
}
