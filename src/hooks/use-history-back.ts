'use client'

/**
 * useHistoryBack — THE back-button pattern for detail surfaces reachable from
 * more than one place. Hard-coding `navigate({ to: '/parent' })` strands the
 * user who arrived from somewhere else (e.g. a brand's Assets tab → asset
 * viewer → "back" dumped them on the assets home). Go back through real
 * history when the app has any; fall back to the canonical parent route on a
 * cold deep-link.
 */
import { useCallback } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'

export function useHistoryBack(fallbackTo: string): () => void {
  const router = useRouter()
  const navigate = useNavigate()
  return useCallback(() => {
    if (router.history.canGoBack()) router.history.back()
    else void navigate({ to: fallbackTo })
  }, [router, navigate, fallbackTo])
}
