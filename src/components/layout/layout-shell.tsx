'use client'

import { useSidebarContext } from '@/context/sidebar-context'
import { ActivityFeed } from '@/components/tasks/activity-feed'

export function LayoutShell({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode
  children: React.ReactNode
}) {
  const { collapsed } = useSidebarContext()

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`fixed top-14 left-0 bottom-0 border-r border-border bg-background hidden md:block overflow-y-auto overflow-x-hidden transition-all duration-150 ease-in-out ${
          collapsed ? 'w-[52px]' : 'w-52'
        }`}
      >
        {sidebar}
      </aside>

      <main
        className={`fixed top-14 bottom-0 right-0 overflow-hidden transition-all duration-150 ease-in-out ${
          collapsed ? 'left-[52px]' : 'left-52'
        }`}
      >
        <div className="h-full overflow-auto flex flex-col"><div className="p-6 flex flex-col flex-1">{children}</div></div>
      </main>

      {/* Activity feed panel */}
      <ActivityFeed />
    </>
  )
}
