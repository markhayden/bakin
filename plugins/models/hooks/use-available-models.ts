'use client'

import { useEffect, useState } from 'react'
import type { AvailableModel } from '@makinbakin/sdk/types'

/**
 * Module-level cache + single-flight promise for the available-models catalog
 * (`GET /api/plugins/models/available`). Two pickers mounting in the same paint
 * share one round-trip. Mirrors useNotificationChannels: read-only and cached —
 * the models management page owns the live `/refresh` mutation flow and keeps its
 * own state rather than using this hook.
 */
let cached: AvailableModel[] | null = null
let inFlight: Promise<AvailableModel[]> | null = null

function fetchAvailableModels(): Promise<AvailableModel[]> {
  if (cached) return Promise.resolve(cached)
  if (inFlight) return inFlight
  inFlight = fetch('/api/plugins/models/available')
    .then((r) => (r.ok ? r.json() : null))
    .then((data: { models?: AvailableModel[] } | null) => {
      const list = data && Array.isArray(data.models) ? data.models : []
      cached = list
      return list
    })
    .catch(() => {
      cached = []
      return [] as AvailableModel[]
    })
    .finally(() => { inFlight = null })
  return inFlight
}

/** The available-models catalog (empty array until loaded / on failure). */
export function useAvailableModels(): AvailableModel[] {
  const [models, setModels] = useState<AvailableModel[]>(() => cached ?? [])

  useEffect(() => {
    if (cached) return
    let cancelled = false
    fetchAvailableModels().then((list) => {
      if (!cancelled) setModels(list)
    })
    return () => { cancelled = true }
  }, [])

  return models
}

/** Test-only: reset the module-level cache so tests run with a clean slate. */
export function __resetAvailableModelsCache(): void {
  if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) return
  cached = null
  inFlight = null
}
