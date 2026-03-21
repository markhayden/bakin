"use client"

import { createContext, useContext, useState } from "react"

export const ActivityContext = createContext({ open: false, toggle: () => {} })
export const useActivityContext = () => useContext(ActivityContext)

export function ActivityProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  const toggle = () => setOpen((o) => !o)
  return (
    <ActivityContext.Provider value={{ open, toggle }}>
      {children}
    </ActivityContext.Provider>
  )
}
