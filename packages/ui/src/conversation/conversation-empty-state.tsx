'use client'

import type { ReactNode } from 'react'

import { Button } from '../primitives/button'
import { cn } from '../utils'

function MessageIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-bakin-5 fill-none stroke-current stroke-[1.5]"
    >
      <path d="M5 5.5h14v9H9l-4 4v-13Z" strokeLinejoin="round" />
      <path d="M8 9h8M8 12h5" strokeLinecap="round" />
    </svg>
  )
}

/** Props for the honest zero-message state shared by conversation surfaces. */
export interface ConversationEmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  suggestions?: readonly string[]
  /** Suggestions render as actions only when their effect is provided. */
  onSuggestion?: (suggestion: string) => void
  className?: string
}

/** Centered conversation start state with optional actionable prompts. */
export function ConversationEmptyState({
  icon,
  title,
  description,
  suggestions,
  onSuggestion,
  className,
}: ConversationEmptyStateProps) {
  const actionableSuggestions = onSuggestion ? suggestions : undefined

  return (
    <section
      data-conv-empty=""
      aria-label={title}
      className={cn(
        'mx-auto flex max-w-md flex-col items-center gap-bakin-3 text-center',
        'font-bakin-typography-family-ui text-[length:var(--bakin-typography-size-body)]',
        className,
      )}
    >
      <div className="flex size-[3rem] items-center justify-center rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default text-bakin-text-muted">
        {icon ?? <MessageIcon />}
      </div>
      <div className="grid gap-bakin-1">
        <h3 className="text-[length:var(--bakin-typography-size-heading-3)] font-bakin-typography-weight-semibold text-bakin-text-primary">
          {title}
        </h3>
        {description ? <p className="leading-relaxed text-bakin-text-muted">{description}</p> : null}
      </div>
      {actionableSuggestions?.length ? (
        <div className="flex flex-wrap justify-center gap-bakin-2 pt-bakin-1">
          {actionableSuggestions.map((suggestion) => (
            <Button
              key={suggestion}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onSuggestion?.(suggestion)}
              className="h-auto min-h-bakin-8 max-w-full whitespace-normal rounded-bakin-pill py-bakin-2 text-left leading-snug"
            >
              {suggestion}
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  )
}
