import { createContext, use } from 'react'

export const SidebarContext = createContext({ collapsed: false, toggle: () => {} })
export const useSidebarContext = () => use(SidebarContext)
