'use client'

import { useSSE } from '@/hooks/use-sse'
import { TooltipProvider } from '@/components/ui/tooltip'

function SSEProvider({ children }: { children: React.ReactNode }) {
  useSSE()
  return <>{children}</>
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <SSEProvider>{children}</SSEProvider>
    </TooltipProvider>
  )
}
