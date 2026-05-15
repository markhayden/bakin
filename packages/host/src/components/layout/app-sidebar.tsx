import { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import {
  CheckSquare,
  Calendar,
  CalendarDays,
  ClipboardList,
  ChevronRight,
  FolderOpen,
  Brain,
  FileText,
  Users,
  Cpu,
  Zap,
  Workflow,
  Layers,
  AlarmClock,
  Activity,
  Compass,
  Settings,
  MessageSquare,
  Sparkles,
} from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { getNavItemsSnapshot, subscribeRegistry } from '@bakin/sdk'
import { useSidebarContext } from '@/context/sidebar-context'
import { usePathname } from '../../hooks/use-pathname'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  CheckSquare,
  Calendar,
  CalendarDays,
  ClipboardList,
  FolderOpen,
  Brain,
  FileText,
  Users,
  Cpu,
  Zap,
  Workflow,
  Layers,
  AlarmClock,
  Activity,
  Compass,
  MessageSquare,
  Sparkles,
}

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const { collapsed } = useSidebarContext()
  // Subscribe to registry mutations so the sidebar re-renders when a
  // plugin hot-swaps (v2 dev mode) — PluginHost's own subscription only
  // forces PluginHost itself to re-render; consumers below need their own.
  const allNavItems = useSyncExternalStore(subscribeRegistry, getNavItemsSnapshot, getNavItemsSnapshot)
  // Runtime registry populated by each plugin's client.mjs via registerPlugin
  // after PluginHost dynamically imports it.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    // Seed initial state: expand any group whose section is active on load
    const initial = new Set<string>()
    for (const item of allNavItems) {
      if (!item.children?.length) continue
      if (pathname === item.href || pathname.startsWith(item.href + '/')) {
        initial.add(item.id)
      }
    }
    return initial
  })
  const prevPathRef = useRef(pathname)

  const settingsActive = pathname === '/settings'

  // Auto-expand when navigating into a section, auto-collapse when leaving
  useEffect(() => {
    const prev = prevPathRef.current
    prevPathRef.current = pathname

    setExpandedIds(current => {
      const next = new Set(current)
      for (const item of allNavItems) {
        if (!item.children?.length) continue
        const wasActive = prev === item.href || prev.startsWith(item.href + '/')
        const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
        if (isActive && !wasActive) next.add(item.id)
        if (!isActive && wasActive) next.delete(item.id)
      }
      return next
    })
  }, [allNavItems, pathname])

  const toggleExpand = (id: string) => {
    setExpandedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <nav className="flex flex-col gap-0.5 px-2 py-3 flex-1">
      {allNavItems.map((item) => {
        const Icon = item.icon ? ICONS[item.icon] : undefined
        const hasChildren = item.children && item.children.length > 0
        const active = pathname === item.href || pathname.startsWith(item.href + '/')

        // Items with children: clickable parent with chevron toggle
        if (hasChildren && !collapsed) {
          const alwaysExpanded = item.alwaysExpanded === true
          const expanded = alwaysExpanded || expandedIds.has(item.id)
          return (
            <div key={item.id} className="flex flex-col">
              <div
                className={`flex items-center rounded-md text-sm transition-colors duration-150 ${
                  active
                    ? 'text-foreground bg-[rgba(255,255,255,0.06)] shadow-[inset_2px_0_0_0_var(--color-pink-500)]'
                    : 'text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.04)]'
                }`}
              >
                <Link
                  to={item.children![0].href}
                  onClick={onNavigate}
                  className="flex items-center gap-3 flex-1 min-w-0 px-3 py-1.5"
                >
                  {Icon && <Icon className="size-4 shrink-0" />}
                  <span>{item.label}</span>
                </Link>
                {!alwaysExpanded && (
                  <button
                    onClick={() => toggleExpand(item.id)}
                    className="shrink-0 mr-1.5 p-1 rounded hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                    aria-label={expanded ? 'Collapse' : 'Expand'}
                  >
                    <ChevronRight className={`size-3 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} />
                  </button>
                )}
              </div>
              {expanded && (
                <div className="mt-1 mb-1 py-1 rounded-md bg-[rgba(255,255,255,0.04)] flex flex-col overflow-hidden">
                  {item.children!.map((child) => {
                    const ChildIcon = child.icon ? ICONS[child.icon] : undefined
                    const childActive = pathname === child.href || pathname.startsWith(child.href + '/')
                    return (
                      <Link
                        key={child.id}
                        to={child.href}
                        onClick={onNavigate}
                        className={`flex items-center gap-2.5 pl-6 pr-3 py-1.5 text-xs transition-colors duration-150 ${
                          childActive
                            ? 'text-foreground bg-[rgba(255,255,255,0.10)]'
                            : 'text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.06)]'
                        }`}
                      >
                        {ChildIcon && <ChildIcon className="size-3.5 shrink-0" />}
                        <span>{child.label}</span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        }

        // Collapsed mode with children: show parent icon, tooltip with label
        if (hasChildren && collapsed) {
          // alwaysExpanded groups use a hover flyout so children remain reachable
          if (item.alwaysExpanded) {
            return (
              <Popover key={item.id}>
                <PopoverTrigger
                  openOnHover
                  delay={120}
                  closeDelay={120}
                  nativeButton={false}
                  render={
                    <Link
                      to={item.children![0].href}
                      onClick={onNavigate}
                      className={`flex items-center justify-center px-0 py-1.5 rounded-md text-sm transition-colors duration-150 ${
                        active
                          ? 'text-foreground bg-[rgba(255,255,255,0.06)] shadow-[inset_2px_0_0_0_var(--color-pink-500)]'
                          : 'text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.04)]'
                      }`}
                    >
                      {Icon && <Icon className="size-4 shrink-0" />}
                    </Link>
                  }
                />
                <PopoverContent
                  side="right"
                  align="start"
                  sideOffset={8}
                  className="w-44 p-1"
                >
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                    {item.label}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {item.children!.map((child) => {
                      const ChildIcon = child.icon ? ICONS[child.icon] : undefined
                      const childActive = pathname === child.href || pathname.startsWith(child.href + '/')
                      return (
                        <Link
                          key={child.id}
                          to={child.href}
                          onClick={onNavigate}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors duration-150 ${
                            childActive
                              ? 'text-foreground bg-[rgba(255,255,255,0.06)]'
                              : 'text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.04)]'
                          }`}
                        >
                          {ChildIcon && <ChildIcon className="size-3.5 shrink-0" />}
                          <span>{child.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            )
          }

          return (
            <Tooltip key={item.id}>
              <TooltipTrigger render={<div />}>
                <Link
                  to={item.children![0].href}
                  onClick={onNavigate}
                  className={`flex items-center justify-center px-0 py-1.5 rounded-md text-sm transition-colors duration-150 ${
                    active
                      ? 'text-foreground bg-[rgba(255,255,255,0.06)] shadow-[inset_2px_0_0_0_var(--color-pink-500)]'
                      : 'text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.04)]'
                  }`}
                >
                  {Icon && <Icon className="size-4 shrink-0" />}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {item.label}
              </TooltipContent>
            </Tooltip>
          )
        }

        // Flat item (no children)
        const linkContent = (
          <Link
            key={item.id}
            to={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 px-3 py-1.5 rounded-md text-sm transition-colors duration-150 ${
              collapsed ? 'justify-center px-0' : ''
            } ${
              active
                ? 'text-foreground bg-[rgba(255,255,255,0.06)] shadow-[inset_2px_0_0_0_var(--color-pink-500)]'
                : 'text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.04)]'
            }`}
          >
            {Icon && <Icon className="size-4 shrink-0" />}
            {!collapsed && <span>{item.label}</span>}
          </Link>
        )

        if (collapsed) {
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger render={<div />}>
                {linkContent}
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {item.label}
              </TooltipContent>
            </Tooltip>
          )
        }

        return linkContent
      })}

      {/* Settings — pinned to bottom */}
      <div className="mt-auto border-t border-border -mx-2 px-2 pt-2">
        <Link
          to="/settings"
          onClick={onNavigate}
          className={`flex items-center gap-3 px-3 py-1.5 rounded-md text-sm transition-colors duration-150 ${
            collapsed ? 'justify-center px-0' : ''
          } ${
            settingsActive
              ? 'text-foreground bg-[rgba(255,255,255,0.06)]'
              : 'text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.04)]'
          }`}
        >
          <Settings className="size-4 shrink-0" />
          {!collapsed && <span>Settings</span>}
        </Link>
      </div>
    </nav>
  )
}
