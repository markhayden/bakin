'use client'

import { useHostStore } from './use-host-store'

export function useDebug(): [debug: boolean, toggleDebug: () => void] {
  const debug = useHostStore((s) => s.debug)
  const toggleDebug = useHostStore((s) => s.toggleDebug)
  return [debug, toggleDebug]
}
