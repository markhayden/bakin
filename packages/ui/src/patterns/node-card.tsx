import * as React from 'react'

import { cn } from '../utils'

export type NodeCardTone = 'neutral' | 'primary' | 'info' | 'accent' | 'highlight'

const TONE_TEXT: Record<NodeCardTone, string> = {
  neutral: 'text-bakin-text-muted',
  primary: 'text-bakin-action-primary-background',
  info: 'text-bakin-signal-info',
  accent: 'text-bakin-signal-accent',
  highlight: 'text-bakin-signal-highlight',
}

const TONE_CHIP: Record<NodeCardTone, string> = {
  neutral: 'bg-bakin-surface-default ring-1 ring-bakin-border-subtle',
  primary: 'bg-bakin-action-primary-background/10 ring-1 ring-bakin-action-primary-background/25',
  info: 'bg-bakin-signal-info/10',
  accent: 'bg-bakin-signal-accent/10',
  highlight: 'bg-bakin-signal-highlight/10',
}

export type NodeCardBorder = 'subtle' | 'tone' | 'strong'

const TONE_BORDER: Record<NodeCardTone, string> = {
  neutral: 'border-bakin-border-subtle',
  primary: 'border-bakin-action-primary-background/60',
  info: 'border-bakin-signal-info/60',
  accent: 'border-bakin-signal-accent/60',
  highlight: 'border-bakin-signal-highlight/60',
}

const TONE_BORDER_STRONG: Record<NodeCardTone, string> = {
  neutral: 'border-bakin-border-subtle',
  primary: 'border-bakin-action-primary-background',
  info: 'border-bakin-signal-info',
  accent: 'border-bakin-signal-accent',
  highlight: 'border-bakin-signal-highlight',
}

export interface NodeCardProps
  extends Omit<React.ComponentPropsWithoutRef<'div'>, 'title'> {
  /** Compact identity chip content — the step-type icon. */
  icon?: React.ReactNode
  /** The step-type label rendered beside the icon chip. */
  typeLabel: React.ReactNode
  /** Colors the type row and icon chip. */
  tone?: NodeCardTone
  /**
   * `subtle` keeps the neutral card border; `tone` tints it with the card
   * tone; `strong` uses the full tone color for emphasized shapes (gates).
   */
  border?: NodeCardBorder
  /** Dashed border for grouping and fan-out shapes. */
  dashed?: boolean
  /**
   * Attention ring for entries needing a human look (stale skills). Wins
   * over the tone border.
   */
  attention?: boolean
  /** Trailing chip beside the type row — status badges. */
  badge?: React.ReactNode
  /** One-line entry title, truncated. */
  title?: React.ReactNode
  /** Vertically centers content for label-only fixed-height nodes. */
  centered?: boolean
}

/**
 * One canvas node card — the shared paint for workflow-graph steps and any
 * future node-graph surface. The card owns surface, border, attention ring,
 * type-row layout, and text hierarchy; consumers own the icon, labels,
 * extra body rows (assignments, excerpts), and any graph-library plumbing
 * (connection handles, positioning) rendered alongside as siblings.
 */
export function NodeCard({
  icon,
  typeLabel,
  tone = 'neutral',
  border = 'subtle',
  dashed = false,
  attention = false,
  badge,
  title,
  centered = false,
  className,
  children,
  ...props
}: NodeCardProps) {
  return (
    <div
      {...props}
      data-slot="node-card"
      data-tone={tone}
      data-attention={attention ? '' : undefined}
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-bakin-surface border-2 bg-bakin-surface-default px-bakin-4 py-bakin-3 shadow-lg',
        centered && 'justify-center',
        dashed && 'border-dashed bg-bakin-surface-default/70',
        attention
          ? 'border-bakin-signal-highlight/70 ring-1 ring-bakin-signal-highlight/25'
          : border === 'strong'
            ? TONE_BORDER_STRONG[tone]
            : border === 'tone'
              ? TONE_BORDER[tone]
              : 'border-bakin-border-subtle',
        className,
      )}
    >
      <div className="mb-bakin-2 flex items-center justify-between gap-bakin-2">
        <div
          data-slot="node-card-type"
          className={cn(
            'flex min-w-0 items-center gap-bakin-2 text-[length:var(--bakin-typography-size-meta)] font-bakin-typography-weight-bold uppercase tracking-wider',
            TONE_TEXT[tone],
          )}
        >
          {icon ? (
            <span
              className={cn(
                'inline-flex size-bakin-6 shrink-0 items-center justify-center rounded-bakin-control',
                TONE_CHIP[tone],
              )}
            >
              {icon}
            </span>
          ) : null}
          <span className="truncate">{typeLabel}</span>
        </div>
        {badge}
      </div>
      {title ? (
        <div
          data-slot="node-card-title"
          className="truncate text-[length:var(--bakin-typography-size-body)] font-bakin-typography-weight-medium leading-5 text-bakin-text-primary"
        >
          {title}
        </div>
      ) : null}
      {children}
    </div>
  )
}
