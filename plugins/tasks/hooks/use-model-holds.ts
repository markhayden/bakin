'use client'

import { useCallback, useEffect, useState } from 'react'

export interface ModelHold {
  /** The persisted selection that is dead (agent pin, route, tag, runtime default). */
  ref: string
  model: string
  detail: string
}

/**
 * Poll the models plugin's per-task model holds (#907): todo tasks whose
 * EFFECTIVE model cannot run on this install. Separate from the budget
 * status poll on purpose — a zero-limit install still gets these holds.
 */
export function useModelHolds(): Record<string, ModelHold> {
  const [holds, setHolds] = useState<Record<string, ModelHold>>({})
  const fetchHolds = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/models/holds')
      if (!res.ok) return
      const data = (await res.json()) as { perTask?: Record<string, ModelHold> }
      setHolds(data.perTask ?? {})
    } catch {
      // best effort — the board renders without badges on a blip
    }
  }, [])
  useEffect(() => {
    fetchHolds()
    const timer = setInterval(fetchHolds, 15_000)
    return () => clearInterval(timer)
  }, [fetchHolds])
  return holds
}
