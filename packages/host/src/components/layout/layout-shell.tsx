import { useSidebarContext } from '@/context/sidebar-context'
import { useActivityContext } from '@/context/activity-context'
import { ActivityFeed } from '@/components/tasks/activity-feed'
import { usePathname, useSearchParams } from '@makinbakin/sdk/hooks'
import { useEffect } from 'react'

export function shouldAutoCollapseActivity(pathname: string, searchParams: URLSearchParams): boolean {
  return pathname === '/health' && searchParams.get('tab') === 'activity'
}

export function LayoutShell({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode
  children: React.ReactNode
}) {
  const { collapsed } = useSidebarContext()
  const { open: activityOpen, close: closeActivity } = useActivityContext()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const collapseForActivityDashboard = shouldAutoCollapseActivity(pathname, searchParams)

  useEffect(() => {
    if (!collapseForActivityDashboard) return
    const timeout = window.setTimeout(closeActivity, 0)
    return () => window.clearTimeout(timeout)
  }, [closeActivity, collapseForActivityDashboard])

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`fixed top-[var(--bakin-shell-top,3.5rem)] left-0 bottom-0 border-r border-border bg-background hidden md:flex flex-col overflow-y-auto overflow-x-hidden transition-all duration-150 ease-in-out ${
          collapsed ? 'w-[52px]' : 'w-52'
        }`}
      >
        {sidebar}
      </aside>

      {/* Content + drawer row */}
      <div
        className={`fixed top-[var(--bakin-shell-top,3.5rem)] bottom-0 right-0 flex transition-all duration-150 ease-in-out left-0 ${
          collapsed ? 'md:left-[52px]' : 'md:left-52'
        }`}
      >
        {/* Main content — fills remaining space */}
        <main className="flex-1 min-w-0 overflow-hidden">
          <div className="h-full overflow-y-auto flex flex-col">{children}</div>
        </main>

        {/* Activity feed panel — fixed width column */}
        <div
          className={`shrink-0 border-l border-zinc-800 bg-background transition-all duration-150 ease-in-out overflow-hidden ${
            activityOpen ? 'w-[360px]' : 'w-0'
          }`}
        >
          <ActivityFeed />
        </div>
      </div>
    </>
  )
}
