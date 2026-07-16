import { ArrowUpRight, Blocks } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

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
        className={`group relative mb-1.5 min-h-[76px] overflow-hidden rounded-lg border px-3 py-2.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          active
            ? 'border-pink-500/45 bg-pink-500/[0.10]'
            : 'border-pink-500/20 bg-pink-500/[0.045] hover:border-pink-500/35 hover:bg-pink-500/[0.075]'
        }`}
      >
        <img
          src="/bakin-hop.svg"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-5 -right-7 w-28 invert opacity-[0.07] transition-opacity duration-150 group-hover:opacity-[0.11]"
        />
        <span className="relative flex items-center gap-1.5 text-xs font-semibold text-foreground">
          Make Bakin Yours
          <ArrowUpRight className="size-3 text-pink-400" aria-hidden="true" />
        </span>
        <span className="relative mt-1 block max-w-[145px] text-[10px] leading-[1.35] text-muted-foreground">
          Do more with Bakin—discover agent kits, plugins &amp; more.
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
      className={`mb-1.5 flex h-9 items-center justify-center rounded-lg border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active
          ? 'border-pink-500/55 bg-pink-500/[0.14] text-pink-300'
          : 'border-pink-500/25 bg-pink-500/[0.06] text-pink-400 hover:border-pink-500/45 hover:bg-pink-500/[0.10] hover:text-pink-300'
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
