'use client'

/**
 * Shared empty-state component for agent-detail tabs.
 *
 * Pattern: centered icon chip → headline → 1-2 line description →
 * optional action (link or callback). Used by Memory, Skills,
 * Knowledge, Heartbeat, and Active Context when their data source
 * is empty or not applicable.
 *
 * Keeping a single component means tone + spacing stay consistent
 * across tabs — different empty surfaces shouldn't feel like they
 * came from different apps.
 */
import { type ComponentType, type ReactNode } from 'react'

export interface EmptyStateProps {
  icon: ComponentType<{ className?: string }>
  title: string
  description?: ReactNode
  action?: ReactNode
  /** When true, the component fills the available height instead of using a fixed minimum. */
  fillHeight?: boolean
}

export function EmptyState({ icon: Icon, title, description, action, fillHeight }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center px-6 ${
        fillHeight ? 'min-h-[calc(100vh-320px)]' : 'py-16'
      }`}
    >
      <div className="size-14 rounded-2xl bg-muted/40 border border-border flex items-center justify-center mb-4">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <div className="text-base font-semibold text-foreground mb-1">{title}</div>
      {description && (
        <div className="text-sm text-muted-foreground max-w-md leading-relaxed">{description}</div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
