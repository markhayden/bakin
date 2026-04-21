'use client'

import { useEffect, useState } from 'react'
import { DEFAULT_CONTENT_TYPES, type ContentTypeOption } from '../types'

/**
 * Module-level cache — one fetch per page load is plenty for messaging UI
 * (content types change rarely and settings updates are reflected after a
 * browser refresh, per the v1 scope in the refactor spec).
 */
let cached: ContentTypeOption[] | null = null

export function useContentTypes(): ContentTypeOption[] {
  const [types, setTypes] = useState<ContentTypeOption[]>(() => cached ?? DEFAULT_CONTENT_TYPES)

  useEffect(() => {
    if (cached) return
    let cancelled = false
    fetch('/api/plugin-settings/messaging')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { contentTypes?: ContentTypeOption[] } | null) => {
        if (cancelled) return
        const list =
          data && Array.isArray(data.contentTypes) && data.contentTypes.length > 0
            ? data.contentTypes
            : DEFAULT_CONTENT_TYPES
        cached = list
        setTypes(list)
      })
      .catch(() => { /* stay on defaults */ })
    return () => { cancelled = true }
  }, [])

  return types
}

export function getContentTypeLabel(id: string, types: ContentTypeOption[]): string {
  return types.find((t) => t.id === id)?.label ?? id
}

/** Test-only: reset the module-level cache so tests run with a clean slate. */
export function __resetContentTypesCache(): void {
  cached = null
}
