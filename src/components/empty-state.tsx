import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: ComponentType<{ className?: string }>
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
  /**
   * Visual size.
   * - `default` — compact rounded chip + small title (the original SDK look).
   * - `panel` — larger rounded-2xl chip + semibold title for full-tab empty
   *   surfaces (folded in from the team plugin's former local variant).
   */
  variant?: 'default' | 'panel'
}

export function EmptyState({ icon: Icon, title, description, action, className, variant = 'default' }: EmptyStateProps) {
  const panel = variant === 'panel'
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        panel ? 'px-6 py-16' : 'py-16',
        className,
      )}
    >
      {Icon &&
        (panel ? (
          <div className="size-14 rounded-2xl bg-muted/40 border border-border flex items-center justify-center mb-4">
            <Icon className="size-6 text-muted-foreground" />
          </div>
        ) : (
          <div className="mb-4 rounded-full bg-muted p-3">
            <Icon className="size-6 text-muted-foreground" />
          </div>
        ))}
      {panel ? (
        <div className="text-base font-semibold text-foreground mb-1">{title}</div>
      ) : (
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
      )}
      {description &&
        (panel ? (
          <div className="text-sm text-muted-foreground max-w-md leading-relaxed">{description}</div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground max-w-sm">{description}</p>
        ))}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
