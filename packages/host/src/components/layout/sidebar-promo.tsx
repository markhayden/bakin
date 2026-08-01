import { ArrowUpRight, Blocks } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Tooltip, TooltipContent, TooltipTrigger } from '@makinbakin/sdk/ui'

interface SidebarPromoProps {
  collapsed: boolean
  pathname: string
  onNavigate?: () => void
}

export function SidebarPromo({ collapsed, pathname, onNavigate }: SidebarPromoProps) {
  const active = pathname === '/explore' || pathname.startsWith('/explore/')

  if (!collapsed) {
    return (
      <Link
        to="/explore"
        onClick={onNavigate}
        data-testid="sidebar-promo"
        aria-current={active ? 'page' : undefined}
        className={`group mb-1.5 min-h-19 rounded-bakin-control border px-3 py-2.5 transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-bakin-focus-ring ${
          active
            ? 'border-bakin-signal-accent/45 bg-bakin-signal-accent/10'
            : 'border-bakin-signal-accent/20 bg-bakin-signal-accent/5 hover:border-bakin-signal-accent/35 hover:bg-bakin-signal-accent/10'
        }`}
      >
        <span className="block text-sm font-semibold text-bakin-text-primary">Make Bakin Yours</span>
        <span className="mt-1 block text-xs leading-4 text-bakin-text-muted">
          Do more with Bakin—discover agent kits, plugins &amp; more.
        </span>
        <span className="mt-2.5 inline-flex items-center gap-1 rounded-bakin-control border border-bakin-signal-accent/25 bg-bakin-signal-accent/10 px-2 py-1 text-bakin-typography-size-meta font-medium text-bakin-signal-accent transition-colors group-hover:border-bakin-signal-accent/40 group-hover:bg-bakin-signal-accent/15">
          Browse add-ons
          <ArrowUpRight className="size-3" aria-hidden="true" />
        </span>
      </Link>
    )
  }

  const link = (
    <Link
      to="/explore"
      onClick={onNavigate}
      data-testid="sidebar-promo"
      aria-label="Make Bakin Yours"
      aria-current={active ? 'page' : undefined}
      className={`mb-1.5 flex h-9 items-center justify-center rounded-bakin-control border transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-bakin-focus-ring ${
        active
          ? 'border-bakin-signal-accent/55 bg-bakin-signal-accent/15 text-bakin-signal-accent'
          : 'border-bakin-signal-accent/25 bg-bakin-signal-accent/5 text-bakin-signal-accent hover:border-bakin-signal-accent/45 hover:bg-bakin-signal-accent/10'
      }`}
    >
      <Blocks className="size-4" aria-hidden="true" />
    </Link>
  )

  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right" sideOffset={8}>Make Bakin Yours</TooltipContent>
    </Tooltip>
  )
}
