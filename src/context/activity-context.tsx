"use client"

import { createContext, useContext, useState } from "react"

const STORAGE_KEY = 'bakin-activity-log-open'

function getInitialState(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === null ? true : stored === 'true'
  } catch {
    return true
  }
}

export const ActivityContext = createContext({ open: false, toggle: () => {} })
export const useActivityContext = () => useContext(ActivityContext)

export function ActivityProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(getInitialState)
  const toggle = () => setOpen((prev) => {
    const next = !prev
    try { localStorage.setItem(STORAGE_KEY, String(next)) } catch {}
    return next
  })
  return (
    <ActivityContext.Provider value={{ open, toggle }}>
      {children}
    </ActivityContext.Provider>
  )
}
