"use client"

import { useState, useEffect } from "react"

export function useSidebar() {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem("sidebar-collapsed")
    if (stored === "true") setCollapsed(true)
  }, [])

  const toggle = () =>
    setCollapsed((c) => {
      localStorage.setItem("sidebar-collapsed", String(!c))
      return !c
    })

  return { collapsed, toggle }
}
