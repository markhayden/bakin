import { useEffect } from 'react'
import { useSSE } from '@/hooks/use-sse'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '../components/layout/toaster'
import { SidebarContext } from '@/context/sidebar-context'
import { ActivityProvider } from '@/context/activity-context'
import { useSidebar } from '@/hooks/use-sidebar'
import { AgentThemeProvider } from './AgentThemeProvider'
import { useContentStore } from '@/hooks/use-content-store'

function SSEProvider({ children }: { children: React.ReactNode }) {
  useSSE()
  return <>{children}</>
}

function DebugSeed() {
  const setDebug = useContentStore((s) => s.setDebug)
  useEffect(() => {
    // Seed from URL query param
    if (new URLSearchParams(window.location.search).get('debug') === 'true') {
      setDebug(true)
    }
  }, [setDebug])
  return null
}

export function Providers({ children }: { children: React.ReactNode }) {
  const sidebar = useSidebar()

  return (
    <TooltipProvider>
      <SidebarContext.Provider value={sidebar}>
        <ActivityProvider>
          <AgentThemeProvider>
            <DebugSeed />
            <SSEProvider>{children}</SSEProvider>
          </AgentThemeProvider>
        </ActivityProvider>
      </SidebarContext.Provider>
      <Toaster />
    </TooltipProvider>
  )
}
