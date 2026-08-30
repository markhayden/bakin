import { ArrowUpRight, Blocks } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Badge, Text, Tooltip, TooltipContent, TooltipTrigger } from '@makinbakin/sdk/ui'
import { cn } from '@makinbakin/sdk/utils'

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
        className={cn('group mb-1.5 min-h-19 rounded-bakin-control border px-bakin-3 py-2.5 transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-bakin-focus-ring', active
            ? 'border-bakin-signal-accent/45 bg-bakin-signal-accent/10'
            : 'border-bakin-signal-accent/20 bg-bakin-signal-accent/5 hover:border-bakin-signal-accent/35 hover:bg-bakin-signal-accent/10')}
      >
        <Text as="span" weight="semibold" className="block">Make Bakin Yours</Text>
        <Text as="span" size="meta" tone="muted" className="mt-bakin-1 block">
          Do more with Bakin—discover agent kits, plugins &amp; more.
        </Text>
        <Badge tone="accent" variant="outline" size="sm" className="mt-2.5">
          Browse add-ons
          <ArrowUpRight aria-hidden="true" />
        </Badge>
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
      className={cn('mb-1.5 flex h-9 items-center justify-center rounded-bakin-control border transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-bakin-focus-ring', active
          ? 'border-bakin-signal-accent/55 bg-bakin-signal-accent/15 text-bakin-signal-accent'
          : 'border-bakin-signal-accent/25 bg-bakin-signal-accent/5 text-bakin-signal-accent hover:border-bakin-signal-accent/45 hover:bg-bakin-signal-accent/10')}
    >
      <Blocks className="size-bakin-4" aria-hidden="true" />
    </Link>
  )

  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right" sideOffset={8}>Make Bakin Yours</TooltipContent>
    </Tooltip>
  )
}
