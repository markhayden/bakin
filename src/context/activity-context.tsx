import { createContext, use, useCallback, useState } from 'react'

const STORAGE_KEY = 'bakin-activity-log-open'

/** SSR-safe default — always true on first render, synced from localStorage in effect */
const DEFAULT_OPEN = true

export const ActivityContext = createContext({ open: false, toggle: () => {}, close: () => {} })
export const useActivityContext = () => use(ActivityContext)

export function ActivityProvider({ children }: { children: React.ReactNode }) {
  // Seeded from localStorage in the initializer (#966b): the shell is
  // client-rendered only, so there is no server frame to mismatch with.
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored !== null) return stored === 'true'
    } catch {
      // storage blocked — fall through to the default
    }
    return DEFAULT_OPEN
  })
  const toggle = useCallback(() => setOpen((prev) => {
    const next = !prev
    try { localStorage.setItem(STORAGE_KEY, String(next)) } catch {}
    return next
  }), [])
  const close = useCallback(() => setOpen((current) => {
    if (!current) return current
    try { localStorage.setItem(STORAGE_KEY, 'false') } catch {}
    return false
  }), [])
  return (
    <ActivityContext value={{ open, toggle, close }}>
      {children}
    </ActivityContext>
  )
}
