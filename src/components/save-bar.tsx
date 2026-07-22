'use client'

import { useEffect } from 'react'

export { SaveBar } from '@makinbakin/sdk/patterns'
export type { SaveBarProps } from '@makinbakin/sdk/patterns'

/**
 * Blocks the hard ways out (tab close, reload) while `dirty`. In-app route
 * guards are the router's job — wire those at the page level where the
 * navigation happens.
 *
 * @deprecated This only protects browser unloads. New work must use the
 * complete `useUnsavedChangesGuard` from `@makinbakin/sdk/navigation`.
 */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Some engines key on returnValue rather than preventDefault.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
}
