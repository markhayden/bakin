import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: ComponentType<{ className?: string }>
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
  /**
   * Visual size.
   * - `default` — compact rounded chip + small title (the original SDK look).
   * - `panel` — larger rounded-2xl chip + semibold title for full-tab empty
   *   surfaces (folded in from the team plugin's former local variant).
   * - `section` — soft in-card empty for a SectionCard body (folded in from
   *   the brands plugin): centered caption in a breathing tinted container,
   *   never a muted sentence blended into section copy.
   */
  variant?: 'default' | 'panel' | 'section'
}

export function EmptyState({ icon: Icon, title, description, action, className, variant = 'default' }: EmptyStateProps) {
  if (variant === 'section') {
    return (
      <div
        className={cn(
          'flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg bg-foreground/[0.03] px-8 py-8 text-center text-sm text-muted-foreground',
          className,
        )}
        data-section-empty
      >
        <p className="max-w-md">{title}</p>
        {description && <p className="max-w-md text-xs text-muted-foreground/80">{description}</p>}
        {action}
      </div>
    )
  }
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
