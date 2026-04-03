'use client'

import { useEffect } from 'react'

/**
 * Warns the user via the browser's beforeunload dialog when they have unsaved changes.
 * Pass `isDirty` from react-hook-form's `formState.isDirty` or a manual flag.
 */
export function useFormGuard(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }

    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])
}
