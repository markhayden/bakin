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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { NavBadge, NavBadgeDot, navBadgeAriaSuffix } from './nav-badge'
import {
  badgeIsActive,
  collapsedParentAriaSuffix,
  collapsedParentRollupTone,
  isNavActive,
} from './nav-badge-logic'

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
  return `${collapsed ? 'justify-center px-0' : 'px-3'} flex w-full items-center gap-3 rounded-md py-1.5 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active
      ? 'bg-foreground/[0.06] text-foreground shadow-[inset_2px_0_0_0_var(--color-pink-500)]'
      : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'
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
        className={`${navRowClass(active, true)} relative`}
        aria-label={`${item.label}${rollupAriaSuffix}`}
      >
        <Icon className="size-4 shrink-0" />
        {rollupTone && <NavBadgeDot tone={rollupTone} />}
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={8} className="w-48 gap-0.5 p-1.5">
        <div className="px-2 py-1.5 text-xs font-semibold text-foreground">{item.label}</div>
        {item.children!.map((child) => {
          const ChildIcon = resolveNavIcon(child.icon)
          const childActive = isNavActive(pathname, child.href)
          const childBadge = badges.get(child.id) ?? child.badge
          return (
            <Link
              key={child.id}
              to={child.href}
              onClick={onNavigate}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                childActive
                  ? 'bg-foreground/[0.07] text-foreground'
                  : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground'
              }`}
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
    const groupId = `sidebar-group-${item.id}`
    return (
      <div className="flex flex-col">
        <button
          type="button"
          onClick={() => onToggle(item.id)}
          className={navRowClass(active, false)}
          aria-expanded={expanded}
          aria-controls={groupId}
          aria-label={`${item.label}${navBadgeAriaSuffix(parentBadge)}`}
        >
          <Icon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
          <NavBadge badge={parentBadge} />
          <ChevronRight
            className={`size-3.5 shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
        </button>
        {expanded && (
          <div
            id={groupId}
            className="mx-1 mb-1 mt-1 flex flex-col overflow-hidden rounded-md bg-foreground/[0.035] py-1"
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
                  className={`flex items-center gap-2.5 px-3 py-1.5 pl-6 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                    childActive
                      ? 'bg-foreground/[0.09] text-foreground'
                      : 'text-muted-foreground hover:bg-foreground/[0.055] hover:text-foreground'
                  }`}
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
      className={`${navRowClass(active, collapsed)} relative`}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? `${item.label}${navBadgeAriaSuffix(flatBadge)}` : undefined}
    >
      <Icon className="size-4 shrink-0" />
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
