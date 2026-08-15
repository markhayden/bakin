'use client'

import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../primitives/collapsible'
import { cn } from '../utils'
import type { StatusTone } from './status-badge'
import { StatusMarker } from './status-marker'

export interface TimelineProps extends ComponentPropsWithoutRef<'ol'> {
  /**
   * Tightens spacing when a Timeline is composed inside a parent entry's body
   * (related events subordinate to a dispatch run, sub-steps of a workflow).
   */
  nested?: boolean
}

/**
 * Ordered chronological feed: an `<ol>` whose entries share a StatusMarker
 * rail and a timestamp gutter. Entry order is the meaning — newest-first or
 * oldest-first stays a consumer decision.
 *
 * Wide containers (container-query driven, never the viewport) move each
 * entry's timestamp into an aligned left gutter; narrow containers keep it
 * inline with the entry title, wrap `meta` onto its own row, and compact
 * status chips to Badge's xs metrics so entries stay two predictable lines.
 */
export function Timeline({ nested = false, className, ...props }: TimelineProps) {
  return (
    <ol
      {...props}
      data-slot="timeline"
      data-nested={nested ? '' : undefined}
      className={cn(
        'm-0 grid min-w-0 list-none p-0',
        nested ? 'mt-bakin-2' : '@container/timeline',
        // A nested timeline sits inside its parent's content column, so it
        // must not re-create the aligned timestamp gutter: a second gutter at
        // a different x reads as a misaligned fragment rather than a child.
        // Subordinate entries keep their time inline instead.
        nested && '@2xl/timeline:[&>li]:grid-cols-[auto_minmax(0,1fr)]',
        nested && '@2xl/timeline:[&_[data-slot=timeline-gutter]]:hidden',
        nested && '@2xl/timeline:[&_[data-slot=timeline-timestamp]]:inline',
        className,
      )}
    />
  )
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      data-slot="timeline-chevron"
      className="ml-auto size-bakin-4 shrink-0 fill-none stroke-current stroke-[1.75] text-bakin-text-muted transition-transform group-data-[panel-open]/timeline-trigger:rotate-90 motion-reduce:transition-none"
    >
      <path d="m6 4.5 3.5 3.5L6 11.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export interface TimelineEntryProps extends Omit<ComponentPropsWithoutRef<'li'>, 'title'> {
  /** Display timestamp. Rendered in the gutter on wide containers, inline when narrow. */
  timestamp?: ReactNode
  /** Machine-readable timestamp for the `<time>` element. */
  dateTime?: string
  /** Colors the StatusMarker on the rail. */
  tone?: StatusTone
  /** Required when the marker alone communicates status (no adjacent status copy). */
  markerLabel?: string
  /** Replaces the StatusMarker dot — e.g. a numbered step. */
  marker?: ReactNode
  title: ReactNode
  /** Inline chips beside the title (StatusBadge, counts, owners). */
  meta?: ReactNode
  /** Collapse `children` behind the header as a keyboard-accessible disclosure. */
  expandable?: boolean
  defaultExpanded?: boolean
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  /**
   * A short qualifying note about this entry — a settle reason, a failure
   * cause, a decision. Renders rail-attached: a tone-colored start rule with
   * no box of its own, so it hangs off the timeline spine instead of
   * competing with it. Reach for a boxed Alert only when the note interrupts
   * the feed's rhythm on purpose.
   */
  note?: ReactNode
  /** Names what `note` is, for readers who need the category stated. */
  noteLabel?: ReactNode
  /** Entry detail: free content, and/or a nested `<Timeline nested>`. */
  children?: ReactNode
}

const NOTE_RULE_CLASSES: Record<StatusTone, string> = {
  neutral: 'border-bakin-border-subtle',
  success: 'border-bakin-action-primary-background',
  attention: 'border-bakin-signal-highlight',
  danger: 'border-bakin-signal-danger',
  accent: 'border-bakin-signal-accent',
}

const HEADER_LAYOUT = 'flex min-w-0 flex-wrap items-center gap-x-bakin-3 gap-y-bakin-1'

/**
 * One event on the Timeline: timestamp + status marker + title + optional
 * meta chips, optional detail body, optional disclosure (Collapsible
 * composition), and optional nested child entries via a `<Timeline nested>`
 * inside `children`.
 */
export function TimelineEntry({
  timestamp,
  dateTime,
  tone = 'neutral',
  markerLabel,
  marker,
  title,
  meta,
  note,
  noteLabel,
  expandable = false,
  defaultExpanded,
  expanded,
  onExpandedChange,
  children,
  className,
  ...props
}: TimelineEntryProps) {
  const inlineTime = timestamp != null ? (
    <time
      dateTime={dateTime}
      data-slot="timeline-timestamp"
      className="shrink-0 font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)] tabular-nums text-bakin-text-muted @2xl/timeline:hidden"
    >
      {timestamp}
    </time>
  ) : null

  const header = (
    <>
      {inlineTime}
      <span
        data-slot="timeline-title"
        className="min-w-0 break-words text-bakin-typography-size-body font-bakin-typography-weight-semibold text-bakin-text-primary"
      >
        {title}
      </span>
      {meta != null ? (
        <span
          data-slot="timeline-meta"
          className={cn(
            // Narrow containers give meta its own full row so chips never
            // straddle the title line, and status chips compact to Badge's
            // xs metrics (mirror badge.tsx size.xs — keep in sync). order-1
            // keeps the disclosure chevron on the title row when meta wraps.
            'order-1 flex min-w-0 basis-full flex-wrap items-center gap-bakin-2 @2xl/timeline:order-none @2xl/timeline:basis-auto',
            '@max-2xl/timeline:[&_[data-status-badge]]:h-bakin-4',
            '@max-2xl/timeline:[&_[data-status-badge]]:min-w-bakin-4',
            '@max-2xl/timeline:[&_[data-status-badge]]:gap-0',
            '@max-2xl/timeline:[&_[data-status-badge]]:px-bakin-1',
            '@max-2xl/timeline:[&_[data-status-badge]]:text-[.625rem]',
            '@max-2xl/timeline:[&_[data-status-badge]]:leading-none',
          )}
        >
          {meta}
        </span>
      ) : null}
    </>
  )

  const noteBlock = note != null ? (
    <div
      data-slot="timeline-entry-note"
      data-tone={tone}
      className={cn(
        // Rail-attached, not boxed: a start rule in the entry's tone, square
        // corners, no surface. The timeline spine is already the boundary —
        // a second rounded outline reads as a detached widget.
        'min-w-0 border-s-2 ps-bakin-3 text-[length:var(--bakin-typography-size-meta)] leading-relaxed text-bakin-text-muted',
        NOTE_RULE_CLASSES[tone],
      )}
    >
      {noteLabel != null ? (
        <span className="font-bakin-typography-weight-semibold text-bakin-text-primary">{noteLabel}: </span>
      ) : null}
      {note}
    </div>
  ) : null

  const body = children != null || noteBlock != null ? (
    <div
      data-slot="timeline-entry-body"
      // The body stacks a note, stats, and disclosures; a shared gap keeps them
      // from crowding each other regardless of which parts an entry has.
      className="mt-bakin-1 flex min-w-0 flex-col gap-bakin-2 text-[length:var(--bakin-typography-size-meta)] leading-relaxed text-bakin-text-muted"
    >
      {noteBlock}
      {children}
    </div>
  ) : null

  return (
    <li
      {...props}
      data-slot="timeline-entry"
      data-tone={tone}
      className={cn(
        'group/timeline-entry grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-bakin-3',
        // An entry with no timestamp must not reserve the gutter — the empty
        // column pushed its marker and title into the middle of the row,
        // reading as a floating fragment rather than a rail entry.
        timestamp != null
          ? '@2xl/timeline:grid-cols-[minmax(7rem,auto)_auto_minmax(0,1fr)]'
          : '@2xl/timeline:grid-cols-[auto_minmax(0,1fr)]',
        className,
      )}
    >
      {timestamp != null ? (
        <span
          data-slot="timeline-gutter"
          className="hidden pt-bakin-1 text-right font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)] tabular-nums text-bakin-text-muted @2xl/timeline:block"
        >
          <time dateTime={dateTime}>{timestamp}</time>
        </span>
      ) : null}

      <span data-slot="timeline-rail" className="relative flex flex-col items-center pt-bakin-1">
        {marker ?? <StatusMarker tone={tone} size="md" label={markerLabel} />}
        <span
          aria-hidden="true"
          data-slot="timeline-rail-line"
          className="mt-bakin-1 w-px flex-1 bg-bakin-border-subtle group-last/timeline-entry:hidden"
        />
      </span>

      <div
        data-slot="timeline-entry-content"
        className="min-w-0 pb-bakin-4 group-last/timeline-entry:pb-bakin-0"
      >
        {expandable ? (
          <Collapsible
            className="border-y-0"
            defaultOpen={defaultExpanded}
            open={expanded}
            // Normalized to exactly (expanded: boolean) — the underlying
            // disclosure's event details stay an implementation detail.
            onOpenChange={onExpandedChange ? (open) => onExpandedChange(open) : undefined}
          >
            <CollapsibleTrigger
              className={cn(
                'group/timeline-trigger min-h-0 justify-start py-bakin-0! font-bakin-typography-weight-regular',
                HEADER_LAYOUT,
              )}
            >
              {header}
              <Chevron />
            </CollapsibleTrigger>
            <CollapsibleContent className="pb-bakin-0">{body}</CollapsibleContent>
          </Collapsible>
        ) : (
          <>
            <div data-slot="timeline-entry-header" className={HEADER_LAYOUT}>
              {header}
            </div>
            {body}
          </>
        )}
      </div>
    </li>
  )
}
