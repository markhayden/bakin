'use client'

import { useSSE } from '@/hooks/use-sse'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/layout/toaster'
import { SidebarContext } from '@/context/sidebar-context'
import { ActivityProvider } from '@/context/activity-context'
import { useSidebar } from '@/hooks/use-sidebar'
import { AgentThemeProvider } from '@/components/providers/agent-theme-provider'

function SSEProvider({ children }: { children: React.ReactNode }) {
  useSSE()
  return <>{children}</>
}

export function Providers({ children }: { children: React.ReactNode }) {
  const sidebar = useSidebar()

  return (
    <TooltipProvider>
      <SidebarContext.Provider value={sidebar}>
        <ActivityProvider>
          <AgentThemeProvider>
            <SSEProvider>{children}</SSEProvider>
          </AgentThemeProvider>
        </ActivityProvider>
      </SidebarContext.Provider>
      <Toaster />
    </TooltipProvider>
  )
}
