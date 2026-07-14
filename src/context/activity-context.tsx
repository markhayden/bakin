import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'bakin-activity-log-open'

/** SSR-safe default — always true on first render, synced from localStorage in effect */
const DEFAULT_OPEN = true

export const ActivityContext = createContext({ open: false, toggle: () => {}, close: () => {} })
export const useActivityContext = () => useContext(ActivityContext)

export function ActivityProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(DEFAULT_OPEN)

  // Sync from localStorage after hydration to avoid server/client mismatch
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored !== null) {
        setOpen(stored === 'true')
      }
    } catch {}
  }, [])
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
    <ActivityContext.Provider value={{ open, toggle, close }}>
      {children}
    </ActivityContext.Provider>
  )
}
