'use client'

/**
 * ConversationEmptyState — designed empty state for a fresh conversation:
 * icon, title, description, optional one-click starter suggestions.
 */
import { MessageSquare } from 'lucide-react'

export interface ConversationEmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  suggestions?: string[]
  onSuggestion?: (suggestion: string) => void
}

export function ConversationEmptyState({
  icon,
  title,
  description,
  suggestions,
  onSuggestion,
}: ConversationEmptyStateProps) {
  return (
    <div className="flex max-w-md flex-col items-center gap-3 text-center" data-conv-empty>
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border bg-muted/40 text-muted-foreground">
        {icon ?? <MessageSquare className="size-5" />}
      </div>
      <div className="space-y-1">
        <div className="text-sm font-medium">{title}</div>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {suggestions?.length ? (
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSuggestion?.(s)}
              className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
