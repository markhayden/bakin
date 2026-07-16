'use client'

import type { ComponentType, ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardAction } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface SectionCardProps {
  title: ReactNode
  /** Lucide icon component rendered before the title. */
  icon?: ComponentType<{ className?: string }>
  /** One line answering "why does this matter to me?" — every user-facing section should have one. */
  description?: ReactNode
  /** Right-aligned header action (button, toggle, hint). */
  action?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

/**
 * The standard titled settings/detail card: icon + title, a muted one-line
 * description explaining why the section matters, an optional header action,
 * and the section body. Compose this instead of hand-rolling card headers so
 * every surface explains itself the same way.
 */
export function SectionCard({
  title,
  icon: Icon,
  description,
  action,
  children,
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <Card className={className} data-section-card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          {Icon && <Icon className="size-4 text-muted-foreground" />}
          {title}
        </CardTitle>
        {/* Caption tier, not body copy — the description must never compete with the section's content. */}
        {description && (
          <CardDescription className="mb-1.5 mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </CardDescription>
        )}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className={cn('space-y-3', contentClassName)}>{children}</CardContent>
    </Card>
  )
}
