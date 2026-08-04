import * as React from 'react'

import { layoutClassName } from './utils'

export type PanelElement = 'div' | 'section' | 'article' | 'aside'
export type PanelTone = 'neutral' | 'success' | 'attention' | 'danger' | 'accent'
export type PanelVariant = 'default' | 'code'
export type PanelPadding = 'default' | 'compact'

interface PanelOwnProps {
  /** Status rail along the panel's start edge. Omit for no rail. */
  tone?: PanelTone
  /** `code` paints the mono, canvas-toned frame for command/output content. */
  variant?: PanelVariant
  padding?: PanelPadding
  /**
   * Bounded internal scrolling. The consumer sets the bound itself (a
   * `max-h-*` class) — the panel owns the scroll behavior and gutter.
   */
  scroll?: boolean
}

type PanelPolymorphicProps<Element extends PanelElement> = PanelOwnProps
  & { as?: Element }
  & Omit<React.ComponentPropsWithRef<Element>, keyof PanelOwnProps | 'as'>

export type PanelProps<Element extends PanelElement = 'div'> = PanelPolymorphicProps<Element>

// Rail colors mirror KanbanCardSignal — the semantic success/attention hues
// are action-primary-background and signal-highlight in this token set.
const toneRailClasses: Record<PanelTone, string> = {
  neutral: 'before:bg-bakin-border-subtle',
  success: 'before:bg-bakin-action-primary-background',
  attention: 'before:bg-bakin-signal-highlight',
  danger: 'before:bg-bakin-signal-danger',
  accent: 'before:bg-bakin-signal-accent',
}

/**
 * The bounded content region: one painted boundary (surface, border, radius)
 * for panels that group related content without being an object Card.
 * Page rhythm still belongs to Section; Panel only paints the box.
 */
export function Panel<Element extends PanelElement = 'div'>({
  as,
  className,
  padding = 'default',
  scroll = false,
  tone,
  variant = 'default',
  ...props
}: PanelProps<Element>) {
  const Component = (as ?? 'div') as React.ElementType
  return (
    <Component
      // A scrollable region must be keyboard-reachable; label it via
      // aria-label/aria-labelledby at the call site.
      tabIndex={scroll ? 0 : undefined}
      {...props}
      data-slot="panel"
      data-variant={variant}
      data-tone={tone}
      data-scroll={scroll ? '' : undefined}
      className={layoutClassName(
        'relative min-w-0 rounded-bakin-surface border border-bakin-border-subtle',
        scroll ? 'overflow-y-auto [scrollbar-gutter:stable]' : 'overflow-hidden',
        padding === 'compact' ? 'p-bakin-3' : 'p-bakin-4',
        variant === 'code'
          ? 'bg-bakin-canvas-default font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)] [overflow-wrap:anywhere] [&_pre]:m-0 [&_pre]:whitespace-pre-wrap'
          : 'bg-bakin-surface-default',
        tone
          ? `before:absolute before:inset-y-0 before:start-0 before:w-bakin-1 before:content-[''] ${toneRailClasses[tone]}`
          : undefined,
        className,
      )}
    />
  )
}
