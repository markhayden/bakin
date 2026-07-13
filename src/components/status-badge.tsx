'use client'

import type { ComponentType, ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type StatusTone = 'neutral' | 'success' | 'warning' | 'destructive' | 'accent'

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-foreground/10 text-muted-foreground',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/15 text-destructive',
  accent: 'bg-accent/15 text-accent',
}

export interface StatusBadgeProps {
  tone?: StatusTone
  icon?: ComponentType<{ className?: string }>
  className?: string
  children: ReactNode
}

/**
 * THE status chip: one tone scale for every "what state is this thing in"
 * badge (Draft/Published/Queued/Blocked/...). Ad-hoc Badge classNames drifted
 * into three different Draft chips across one plugin — status chips compose
 * this instead so state reads the same everywhere.
 */
export function StatusBadge({ tone = 'neutral', icon: Icon, className, children }: StatusBadgeProps) {
  return (
    <Badge className={cn('gap-1', TONE_CLASSES[tone], className)} data-status-badge={tone}>
      {Icon && <Icon className="size-3" />}
      {children}
    </Badge>
  )
}
