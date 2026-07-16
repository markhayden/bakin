import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { NavItem } from '@makinbakin/sdk'
import {
  getNavBadgesSnapshot,
  getNavItemsSnapshot,
  subscribeNavBadges,
  subscribeRegistry,
} from '@makinbakin/sdk/internal'
import { useSidebarContext } from '@/context/sidebar-context'
import { usePathname } from '../../hooks/use-pathname'
import { buildSidebarNavModel } from './nav-placement'
import { isNavActive } from './nav-badge-logic'
import { SidebarNavItem } from './sidebar-nav-item'

const UTILITY_ITEMS: NavItem[] = [
  { id: 'runtime', label: 'Runtime', icon: 'ServerCog', href: '/runtime' },
  { id: 'settings', label: 'Settings', icon: 'Settings', href: '/settings' },
]

export function AppSidebar({
  onNavigate,
  forceExpanded = false,
}: {
  onNavigate?: () => void
  forceExpanded?: boolean
}) {
  const pathname = usePathname()
  const { collapsed: sidebarCollapsed } = useSidebarContext()
  const collapsed = forceExpanded ? false : sidebarCollapsed
  const allNavItems = useSyncExternalStore(subscribeRegistry, getNavItemsSnapshot, getNavItemsSnapshot)
  const navBadges = useSyncExternalStore(subscribeNavBadges, getNavBadgesSnapshot, getNavBadgesSnapshot)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    for (const item of allNavItems) {
      if (item.children?.length && isNavActive(pathname, item.href)) initial.add(item.id)
    }
    return initial
  })
  const prevPathRef = useRef(pathname)

  useEffect(() => {
    const previousPath = prevPathRef.current
    prevPathRef.current = pathname
    setExpandedIds((current) => {
      const next = new Set(current)
      for (const item of allNavItems) {
        if (!item.children?.length) continue
        const wasActive = isNavActive(previousPath, item.href)
        const active = isNavActive(pathname, item.href)
        if (active) next.add(item.id)
        else if (wasActive) next.delete(item.id)
      }
      return next
    })
  }, [allNavItems, pathname])

  const toggleExpand = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const model = buildSidebarNavModel(allNavItems)
  const renderNavItem = (item: (typeof allNavItems)[number]) => (
    <SidebarNavItem
      key={item.id}
      item={item}
      collapsed={collapsed}
      pathname={pathname}
      badges={navBadges}
      expanded={expandedIds.has(item.id)}
      onToggle={toggleExpand}
      onNavigate={onNavigate}
    />
  )

  return (
    <nav aria-label="Main navigation" className="flex h-full min-h-0 w-full flex-col overflow-hidden px-2 py-3">
      <div role="group" aria-label="Primary" className="flex shrink-0 flex-col gap-0.5 border-b border-border/70 pb-2">
        {model.primary.map(renderNavItem)}
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain py-2">
        {model.sections.map((section, index) => {
          const headingId = `sidebar-section-${section.id}`
          return (
            <section
              key={section.id}
              aria-labelledby={headingId}
              className={collapsed
                ? `${index > 0 ? 'mt-2 border-t border-border/60 pt-2' : ''} flex flex-col gap-0.5`
                : `${index > 0 ? 'mt-3' : ''} flex flex-col gap-0.5`
              }
            >
              <h2
                id={headingId}
                className={collapsed
                  ? 'sr-only'
                  : 'px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70'
                }
              >
                {section.label}
              </h2>
              {section.items.map(renderNavItem)}
            </section>
          )
        })}
      </div>

      <div role="group" aria-label="Utilities" className="flex shrink-0 flex-col gap-0.5 border-t border-border/70 pt-2">
        {UTILITY_ITEMS.map(renderNavItem)}
      </div>
    </nav>
  )
}
