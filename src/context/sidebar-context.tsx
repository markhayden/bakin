import { createContext, useContext } from 'react'

export const SidebarContext = createContext({ collapsed: false, toggle: () => {} })
export const useSidebarContext = () => useContext(SidebarContext)
