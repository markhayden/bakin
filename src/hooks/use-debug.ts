'use client'

import { useCallback } from 'react'
import { useContentStore } from './use-content-store'

export function useDebug(): [debug: boolean, toggleDebug: () => void] {
  const debug = useContentStore((s) => s.debug)
  const setDebug = useContentStore((s) => s.setDebug)
  const toggleDebug = useCallback(() => setDebug(!debug), [debug, setDebug])
  return [debug, toggleDebug]
}
