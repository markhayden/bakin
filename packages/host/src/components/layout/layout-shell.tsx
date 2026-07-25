import { useSidebarContext } from '@/context/sidebar-context'
import { useActivityContext } from '@/context/activity-context'
import { ActivityFeed } from '@/components/tasks/activity-feed'
import { Button } from '@/components/ui/button'
import { usePathname, useSearchParams } from '@makinbakin/sdk/hooks'
import { useEffect } from 'react'

const SHELL_TOP_CLASS = 'top-[var(--bakin-shell-top,3.5rem)]'

export function shouldAutoCollapseActivity(pathname: string, searchParams: URLSearchParams): boolean {
  return pathname === '/health' && searchParams.get('tab') === 'activity'
}

export function shouldAutoCollapseActivityForViewport(viewportWidth: number): boolean {
  return viewportWidth < 768
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
    const collapseForViewport = shouldAutoCollapseActivityForViewport(window.innerWidth)
    if (!collapseForActivityDashboard && !collapseForViewport) return
    const timeout = window.setTimeout(closeActivity, 0)
    return () => window.clearTimeout(timeout)
  }, [closeActivity, collapseForActivityDashboard])

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`fixed ${SHELL_TOP_CLASS} left-0 bottom-0 border-r border-border bg-background hidden md:flex flex-col overflow-hidden transition-all duration-150 ease-in-out ${
          collapsed ? 'w-[52px]' : 'w-52'
        }`}
      >
        {sidebar}
      </aside>

      {/* Content + drawer row */}
      <div
        className={`fixed ${SHELL_TOP_CLASS} bottom-0 right-0 flex transition-all duration-150 ease-in-out left-0 ${
          collapsed ? 'md:left-[52px]' : 'md:left-52'
        }`}
      >
        {/* Main content — fills remaining space. The inner div is the app's
            real scroll container; the id attribute opts it into TanStack's
            element-level scroll restoration (router scrollRestoration: true). */}
        <main className="flex-1 min-w-0 overflow-hidden">
          <div data-scroll-restoration-id="bakin-main" className="h-full overflow-y-auto flex flex-col">{children}</div>
        </main>

        {activityOpen ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-hidden="true"
            tabIndex={-1}
            className={`fixed inset-x-0 bottom-0 ${SHELL_TOP_CLASS} z-40 h-auto w-auto rounded-none border-0 bg-bakin-canvas-default/75 p-0 active:not-aria-[haspopup]:translate-y-0 md:hidden`}
            onClick={closeActivity}
          />
        ) : null}

        {/* Activity feed panel — a desktop rail and a mobile overlay. */}
        <aside
          aria-label="Live Activity"
          data-slot="activity-panel"
          className={`fixed bottom-0 right-0 ${SHELL_TOP_CLASS} z-50 max-w-full shrink-0 bg-background transition-[width] duration-150 ease-in-out md:static md:z-auto ${
            activityOpen
              ? 'w-[360px] overflow-hidden border-l border-bakin-border-subtle'
              : 'w-0 overflow-visible border-l border-transparent'
          }`}
        >
          <ActivityFeed />
        </aside>
      </div>
    </>
  )
}
