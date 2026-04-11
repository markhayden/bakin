'use client'

import { useContentStore } from './use-content-store'

export function useDebug(): [debug: boolean, toggleDebug: () => void] {
  const debug = useContentStore((s) => s.debug)
  const toggleDebug = useContentStore((s) => s.toggleDebug)
  return [debug, toggleDebug]
}
