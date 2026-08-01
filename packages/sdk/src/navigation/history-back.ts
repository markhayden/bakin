'use client'

import { useNavigate, useRouter as useTanStackRouter } from '@tanstack/react-router'
import { useCallback } from 'react'

/**
 * Return through real history when possible, with a stable fallback for cold
 * deep links that have no in-app history entry.
 */
export function useHistoryBack(fallbackTo: string): () => void {
  const router = useTanStackRouter()
  const navigate = useNavigate()
  return useCallback(() => {
    if (router.history.canGoBack()) router.history.back()
    else void navigate({ to: fallbackTo })
  }, [router, navigate, fallbackTo])
}
