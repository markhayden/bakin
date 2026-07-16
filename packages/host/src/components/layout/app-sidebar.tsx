import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Cpu, Settings } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import {
  getNavBadgesSnapshot,
  getNavItemsSnapshot,
  subscribeNavBadges,
  subscribeRegistry,
} from '@makinbakin/sdk/internal'
import { useSidebarContext } from '@/context/sidebar-context'
import { usePathname } from '../../hooks/use-pathname'
import { partitionNavItems } from './nav-placement'
import { isNavActive } from './nav-badge-logic'
import { SidebarNavItem } from './sidebar-nav-item'

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const { collapsed } = useSidebarContext()
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

  const { main: mainNavItems, bottom: bottomNavItems } = partitionNavItems(allNavItems)
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
  const utilityLinkClass = (active: boolean) => `${collapsed ? 'justify-center px-0' : 'px-3'} flex items-center gap-3 rounded-md py-1.5 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active
      ? 'bg-foreground/[0.06] text-foreground'
      : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'
  }`

  return (
    <nav className="flex flex-1 flex-col gap-0.5 px-2 py-3">
      {mainNavItems.map(renderNavItem)}
      <div className="-mx-2 mt-auto flex flex-col gap-0.5 border-t border-border px-2 pt-2">
        {bottomNavItems.map(renderNavItem)}
        <Link to="/runtime" onClick={onNavigate} className={utilityLinkClass(pathname === '/runtime')}>
          <Cpu className="size-4 shrink-0" />
          {!collapsed && <span>Runtime</span>}
        </Link>
        <Link to="/settings" onClick={onNavigate} className={utilityLinkClass(pathname === '/settings')}>
          <Settings className="size-4 shrink-0" />
          {!collapsed && <span>Settings</span>}
        </Link>
      </div>
    </nav>
  )
}
