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
} from 'lucide-react'
import { NAV_ITEMS } from '@/lib/constants'

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  CheckSquare,
  Calendar,
  FolderOpen,
  Brain,
  FileText,
  Users,
}

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <nav className="flex flex-col gap-0.5 px-2 py-3">
      {NAV_ITEMS.map((item) => {
        const Icon = ICONS[item.icon]
        const active = pathname === item.href || pathname.startsWith(item.href + '/')

        return (
          <Link
            key={item.id}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 px-3 py-1.5 rounded-md text-sm transition-colors duration-150 ${
              active
                ? 'text-foreground bg-[rgba(255,255,255,0.06)]'
                : 'text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.04)]'
            }`}
          >
            <Icon className="size-4 shrink-0" />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
