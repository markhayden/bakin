'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CheckSquare,
  Calendar,
  FolderOpen,
  Brain,
  FileText,
  Users,
  Cpu,
  Zap,
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
  FolderOpen,
  Brain,
  FileText,
  Users,
  Cpu,
  Zap,
}

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const { collapsed, toggle } = useSidebarContext()

  return (
    <nav className="flex flex-col gap-0.5 px-2 py-3">
      {allNavItems.map((item) => {
        const Icon = ICONS[item.icon]
        const active = pathname === item.href || pathname.startsWith(item.href + '/')

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
    </nav>
  )
}
