'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CheckSquare,
  Calendar,
  CalendarDays,
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
import { allNavItems } from '@/lib/plugin-manifest'
import { useSidebarContext } from '@/context/sidebar-context'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  CheckSquare,
  Calendar,
  CalendarDays,
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
  const { collapsed, toggle } = useSidebarContext()
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
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
  }, [pathname])

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
        const Icon = ICONS[item.icon]
        const hasChildren = item.children && item.children.length > 0
        const active = pathname === item.href || pathname.startsWith(item.href + '/')

        // Items with children: clickable parent with chevron toggle
        if (hasChildren && !collapsed) {
          const expanded = expandedIds.has(item.id)
          return (
            <div key={item.id} className="flex flex-col">
              <div
                className={`flex items-center gap-3 px-3 py-1.5 rounded-md text-sm transition-colors duration-150 ${
                  active
                    ? 'text-foreground bg-[rgba(255,255,255,0.06)]'
                    : 'text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.04)]'
                }`}
              >
                <button
                  onClick={() => toggleExpand(item.id)}
                  className="shrink-0 -ml-1 p-0.5 rounded hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                >
                  <ChevronRight className={`size-3 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} />
                </button>
                <Link
                  href={item.children![0].href}
                  onClick={onNavigate}
                  className="flex items-center gap-3 flex-1 min-w-0"
                >
                  {Icon && <Icon className="size-4 shrink-0" />}
                  <span>{item.label}</span>
                </Link>
              </div>
              {expanded && (
                <div className="flex flex-col gap-0.5 ml-7 mt-0.5">
                  {item.children!.map((child) => {
                    const ChildIcon = ICONS[child.icon]
                    const childActive = pathname === child.href || pathname.startsWith(child.href + '/')
                    return (
                      <Link
                        key={child.id}
                        href={child.href}
                        onClick={onNavigate}
                        className={`flex items-center gap-3 px-3 py-1.5 rounded-md text-sm transition-colors duration-150 ${
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
              )}
            </div>
          )
        }

        // Collapsed mode with children: show parent icon, tooltip with label
        if (hasChildren && collapsed) {
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger render={<div />}>
                <Link
                  href={item.children![0].href}
                  onClick={onNavigate}
                  className={`flex items-center justify-center px-0 py-1.5 rounded-md text-sm transition-colors duration-150 ${
                    active
                      ? 'text-foreground bg-[rgba(255,255,255,0.06)]'
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
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 px-3 py-1.5 rounded-md text-sm transition-colors duration-150 ${
              collapsed ? 'justify-center px-0' : ''
            } ${
              active
                ? 'text-foreground bg-[rgba(255,255,255,0.06)]'
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
          href="/settings"
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
