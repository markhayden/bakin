import {
  Activity,
  AlarmClock,
  Brain,
  Blocks,
  Calendar,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  ChevronRight,
  ClipboardList,
  Compass,
  Cpu,
  FileText,
  FolderKanban,
  FolderOpen,
  HeartPulse,
  Layers,
  Lightbulb,
  Megaphone,
  MessageSquare,
  Paintbrush,
  Puzzle,
  ServerCog,
  Settings,
  Sparkles,
  Users,
  Workflow,
  Zap,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { NavBadge as NavBadgeData, NavItem } from '@makinbakin/sdk'
import { Popover, PopoverContent, PopoverTrigger, Tooltip, TooltipContent, TooltipTrigger } from '@makinbakin/sdk/ui'
import { NavBadge, NavBadgeDot, navBadgeAriaSuffix } from './nav-badge'
import {
  badgeIsActive,
  closedGroupRollupBadge,
  collapsedParentAriaSuffix,
  collapsedParentRollupTone,
  isNavActive,
} from './nav-badge-logic'
import { cn } from '@makinbakin/sdk/utils'

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Activity,
  AlarmClock,
  Brain,
  Blocks,
  Calendar,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  Compass,
  Cpu,
  FileText,
  FolderKanban,
  FolderOpen,
  HeartPulse,
  Layers,
  Lightbulb,
  Megaphone,
  MessageSquare,
  Paintbrush,
  Puzzle,
  ServerCog,
  Settings,
  Sparkles,
  Users,
  Workflow,
  Zap,
}

export function resolveNavIcon(name: string | undefined) {
  return (name && ICONS[name]) || Puzzle
}

interface SidebarNavItemProps {
  item: NavItem
  collapsed: boolean
  pathname: string
  badges: ReadonlyMap<string, NavBadgeData>
  expanded: boolean
  onToggle: (id: string) => void
  onNavigate?: () => void
}

function navRowClass(active: boolean, collapsed: boolean): string {
  return `${collapsed ? 'justify-center px-0' : 'px-bakin-3'} flex w-full items-center gap-bakin-3 rounded-bakin-control py-1.5 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-bakin-focus-ring ${
    active
      ? 'bg-bakin-border-subtle/35 text-bakin-text-primary shadow-[inset_2px_0_0_0_var(--bakin-color-signal-accent)]'
      : 'text-bakin-text-muted hover:bg-bakin-border-subtle/20 hover:text-bakin-text-primary'
  }`
}

function CollapsedNavGroup({
  item,
  pathname,
  badges,
  onNavigate,
}: Pick<SidebarNavItemProps, 'item' | 'pathname' | 'badges' | 'onNavigate'>) {
  const [open, setOpen] = useState(false)
  const suppressRestoredFocusRef = useRef(false)
  const Icon = resolveNavIcon(item.icon)
  const active = isNavActive(pathname, item.href)
  const parentBadge = badges.get(item.id) ?? item.badge
  const rollupTone = collapsedParentRollupTone(item, parentBadge, badges)
  const rollupAriaSuffix = collapsedParentAriaSuffix(parentBadge, rollupTone)

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && details.reason === 'escape-key') suppressRestoredFocusRef.current = true
        setOpen(nextOpen)
      }}
    >
      <PopoverTrigger
        type="button"
        openOnHover
        delay={120}
        closeDelay={120}
        onFocus={() => {
          if (suppressRestoredFocusRef.current) {
            suppressRestoredFocusRef.current = false
            return
          }
          setOpen(true)
        }}
        className={cn(navRowClass(active, true), 'relative')}
        aria-label={`${item.label}${rollupAriaSuffix}`}
      >
        <Icon className="size-bakin-4 shrink-0" />
        {rollupTone && <NavBadgeDot tone={rollupTone} />}
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={8} className="w-48 gap-0.5 p-1.5">
        <div className="px-bakin-2 py-1.5 text-xs font-bakin-typography-weight-semibold text-bakin-text-primary">{item.label}</div>
        {item.children!.map((child) => {
          const ChildIcon = resolveNavIcon(child.icon)
          const childActive = isNavActive(pathname, child.href)
          const childBadge = badges.get(child.id) ?? child.badge
          return (
            <Link
              key={child.id}
              to={child.href}
              onClick={onNavigate}
              className={cn('flex items-center gap-bakin-2 rounded-bakin-control px-bakin-2 py-1.5 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-bakin-focus-ring', childActive
                  ? 'bg-bakin-border-subtle/35 text-bakin-text-primary'
                  : 'text-bakin-text-muted hover:bg-bakin-border-subtle/20 hover:text-bakin-text-primary')}
              aria-current={childActive ? 'page' : undefined}
              aria-label={`${child.label}${navBadgeAriaSuffix(childBadge)}`}
            >
              <ChildIcon className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{child.label}</span>
              <NavBadge badge={childBadge} />
            </Link>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

export function SidebarNavItem({
  item,
  collapsed,
  pathname,
  badges,
  expanded,
  onToggle,
  onNavigate,
}: SidebarNavItemProps) {
  const Icon = resolveNavIcon(item.icon)
  const hasChildren = Boolean(item.children?.length)
  const active = isNavActive(pathname, item.href)
  const badgeFor = (target: NavItem): NavBadgeData | undefined => badges.get(target.id) ?? target.badge

  if (hasChildren && !collapsed) {
    const parentBadge = badgeFor(item)
    // Closed group → the children (and their badges) are hidden, so roll
    // their badges up into the header; open group → the children show their
    // own badges, the header keeps only its own.
    const headerBadge = expanded ? parentBadge : closedGroupRollupBadge(item, parentBadge, badges)
    const groupId = `sidebar-group-${item.id}`
    return (
      <div className="flex flex-col">
        <button
          type="button"
          onClick={() => onToggle(item.id)}
          className={navRowClass(active, false)}
          aria-expanded={expanded}
          aria-controls={groupId}
          aria-label={`${item.label}${navBadgeAriaSuffix(headerBadge)}`}
        >
          <Icon className="size-bakin-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
          <NavBadge badge={headerBadge} />
          <ChevronRight
            className={cn('size-3.5 shrink-0 transition-transform duration-150', expanded ? 'rotate-90' : '')}
            aria-hidden="true"
          />
        </button>
        {expanded && (
          <div
            id={groupId}
            className="mx-bakin-1 mb-bakin-1 mt-bakin-1 flex flex-col overflow-hidden rounded-bakin-control bg-bakin-border-subtle/20 py-bakin-1"
          >
            {item.children!.map((child) => {
              const ChildIcon = resolveNavIcon(child.icon)
              const childActive = isNavActive(pathname, child.href)
              const childBadge = badgeFor(child)
              return (
                <Link
                  key={child.id}
                  to={child.href}
                  onClick={onNavigate}
                  className={cn('flex items-center gap-2.5 px-bakin-3 py-1.5 pl-bakin-6 text-xs transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-bakin-focus-ring', childActive
                      ? 'bg-bakin-border-subtle/40 text-bakin-text-primary'
                      : 'text-bakin-text-muted hover:bg-bakin-border-subtle/25 hover:text-bakin-text-primary')}
                  aria-current={childActive ? 'page' : undefined}
                  aria-label={`${child.label}${navBadgeAriaSuffix(childBadge)}`}
                >
                  <ChildIcon className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{child.label}</span>
                  <NavBadge badge={childBadge} />
                </Link>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  if (hasChildren) {
    return <CollapsedNavGroup item={item} pathname={pathname} badges={badges} onNavigate={onNavigate} />
  }

  const flatBadge = badgeFor(item)
  const flatTone = badgeIsActive(flatBadge) ? (flatBadge.tone ?? 'attention') : null
  const link = (
    <Link
      to={item.href}
      onClick={onNavigate}
      className={cn(navRowClass(active, collapsed), 'relative')}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? `${item.label}${navBadgeAriaSuffix(flatBadge)}` : undefined}
    >
      <Icon className="size-bakin-4 shrink-0" />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {!collapsed && <NavBadge badge={flatBadge} />}
      {collapsed && flatTone && <NavBadgeDot tone={flatTone} />}
    </Link>
  )

  if (!collapsed) return link

  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right" sideOffset={8}>{item.label}</TooltipContent>
    </Tooltip>
  )
}
