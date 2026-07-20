import type { ComponentPropsWithoutRef, ComponentType, ReactNode } from 'react'

import { Badge } from '../primitives/badge'
import { cn } from '../utils'

export type StatusTone = 'neutral' | 'success' | 'attention' | 'danger' | 'accent'
export type StatusBadgeVariant = 'soft' | 'solid' | 'outline'

export interface StatusBadgeProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  tone?: StatusTone
  variant?: StatusBadgeVariant
  icon?: ComponentType<{ className?: string }>
  children: ReactNode
}

/** Compact state label whose visible copy carries meaning independently of color. */
export function StatusBadge({
  tone = 'neutral',
  variant = 'soft',
  icon: Icon,
  className,
  children,
  ...props
}: StatusBadgeProps) {
  return (
    <Badge
      tone={tone}
      variant={variant}
      data-status-badge={tone}
      data-tone={tone}
      data-variant={variant}
      {...props}
      className={cn('max-w-full', className)}
    >
      {Icon ? <span aria-hidden="true" className="inline-flex shrink-0"><Icon className="size-bakin-3" /></span> : null}
      <span className="truncate">{children}</span>
    </Badge>
  )
}
