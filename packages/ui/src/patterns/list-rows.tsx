import { createContext, forwardRef, useContext, useId } from 'react'
import type { CSSProperties, ComponentPropsWithoutRef, ReactNode } from 'react'

import { cn } from '../utils'
import {
  interactiveOverlay,
  interactiveSurfaceClasses,
  type InteractiveAction,
} from '../primitives/interactive-surface'

export type ListRowsVariant = 'bordered' | 'separated' | 'plain'

/** Container breakpoints at which `columns` rows adopt the shared template. */
export type ListRowsColumnsAt = 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl'

/** Cross-axis alignment of row cells once the shared template is active. */
export type ListRowsColumnsAlign = 'start' | 'center' | 'end'

export interface ListRowsProps extends ComponentPropsWithoutRef<'ul'> {
  /**
   * `bordered` gives every row a distinct interactive/resource boundary.
   * `separated` groups dense peers with shared dividers.
   * `plain` provides semantic list structure without visual boundaries.
   */
  variant?: ListRowsVariant
  /**
   * Shared `grid-template-columns` track list (e.g.
   * `'minmax(9rem,.7fr) minmax(0,1fr) auto'`) applied to every row once the
   * list container reaches `columnsAt`. Below the breakpoint each row stacks
   * its cells vertically, so narrow containers degrade without horizontal
   * scrolling. One parameterized mechanism — the consumer owns the track
   * list — replaces per-surface hand-rolled "grid-as-table" rows while the
   * list keeps honest `list`/`listitem` semantics: every cell must remain
   * self-describing (its own label, `<dl>`, or field), because columns are a
   * visual alignment aid, not table semantics. Reach for a real table
   * component when users need column-wise comparison semantics.
   */
  columns?: string
  /**
   * Container breakpoint (measured against the list itself) where rows adopt
   * the shared template. Defaults to `3xl` (48rem), the most common switch
   * point in the absorbed implementations.
   */
  columnsAt?: ListRowsColumnsAt
  /** Cell alignment once the template is active. Defaults to `center`. */
  columnsAlign?: ListRowsColumnsAlign
}

interface ListRowsColumnsState {
  at: ListRowsColumnsAt
  align: ListRowsColumnsAlign
}

const ListRowsColumnsContext = createContext<ListRowsColumnsState | null>(null)
const ListRowGroupLabelContext = createContext<string | undefined>(undefined)

const variantClasses: Record<ListRowsVariant, string> = {
  bordered: [
    'grid gap-bakin-2',
    '[&>[data-slot=list-row]]:rounded-bakin-surface',
    '[&>[data-slot=list-row]]:border',
    '[&>[data-slot=list-row]]:border-bakin-border-subtle',
    '[&>[data-slot=list-row]]:bg-bakin-surface-default',
  ].join(' '),
  separated: [
    'border-y border-bakin-border-subtle',
    '[&>[data-slot=list-row]:not(:last-child)]:border-b',
    '[&>[data-slot=list-row]:not(:last-child)]:border-bakin-border-subtle',
  ].join(' '),
  plain: 'grid',
}

/**
 * Tailwind requires complete literal class strings, so every supported
 * breakpoint carries its own pre-written variant classes.
 */
const columnsTemplateClasses: Record<ListRowsColumnsAt, string> = {
  lg: '@lg/list-rows:[grid-template-columns:var(--bakin-list-row-columns)]',
  xl: '@xl/list-rows:[grid-template-columns:var(--bakin-list-row-columns)]',
  '2xl': '@2xl/list-rows:[grid-template-columns:var(--bakin-list-row-columns)]',
  '3xl': '@3xl/list-rows:[grid-template-columns:var(--bakin-list-row-columns)]',
  '4xl': '@4xl/list-rows:[grid-template-columns:var(--bakin-list-row-columns)]',
  '5xl': '@5xl/list-rows:[grid-template-columns:var(--bakin-list-row-columns)]',
}

const columnsAlignClasses: Record<ListRowsColumnsAt, Record<ListRowsColumnsAlign, string>> = {
  lg: {
    start: '@lg/list-rows:items-start',
    center: '@lg/list-rows:items-center',
    end: '@lg/list-rows:items-end',
  },
  xl: {
    start: '@xl/list-rows:items-start',
    center: '@xl/list-rows:items-center',
    end: '@xl/list-rows:items-end',
  },
  '2xl': {
    start: '@2xl/list-rows:items-start',
    center: '@2xl/list-rows:items-center',
    end: '@2xl/list-rows:items-end',
  },
  '3xl': {
    start: '@3xl/list-rows:items-start',
    center: '@3xl/list-rows:items-center',
    end: '@3xl/list-rows:items-end',
  },
  '4xl': {
    start: '@4xl/list-rows:items-start',
    center: '@4xl/list-rows:items-center',
    end: '@4xl/list-rows:items-end',
  },
  '5xl': {
    start: '@5xl/list-rows:items-start',
    center: '@5xl/list-rows:items-center',
    end: '@5xl/list-rows:items-end',
  },
}

const labelsVisibleClasses: Record<ListRowsColumnsAt, string> = {
  lg: '@lg/list-rows:grid',
  xl: '@xl/list-rows:grid',
  '2xl': '@2xl/list-rows:grid',
  '3xl': '@3xl/list-rows:grid',
  '4xl': '@4xl/list-rows:grid',
  '5xl': '@5xl/list-rows:grid',
}

/** Semantic list container that makes the relationship between repeated rows explicit. */
export function ListRows({
  variant = 'bordered',
  columns,
  columnsAt = '3xl',
  columnsAlign = 'center',
  className,
  style,
  ...props
}: ListRowsProps) {
  const groupLabelId = useContext(ListRowGroupLabelContext)
  const hasOwnLabel =
    props['aria-label'] !== undefined || props['aria-labelledby'] !== undefined
  const columnsState: ListRowsColumnsState | null = columns
    ? { at: columnsAt, align: columnsAlign }
    : null
  return (
    <ListRowsColumnsContext.Provider value={columnsState}>
      <ul
        aria-labelledby={hasOwnLabel ? undefined : groupLabelId}
        {...props}
        data-list-rows=""
        data-variant={variant}
        data-columns={columns ? '' : undefined}
        style={
          columns
            ? ({ ...style, '--bakin-list-row-columns': columns } as CSSProperties)
            : style
        }
        className={cn(
          'm-0 min-w-0 list-none p-0',
          columns && '@container/list-rows',
          variantClasses[variant],
          className,
        )}
      />
    </ListRowsColumnsContext.Provider>
  )
}

export type ListRowProps = ComponentPropsWithoutRef<'li'> & {
  /**
   * Whole-row activation: one overlay control (button, or `render` for links)
   * with a real focus ring; nested controls keep their own behavior. Never
   * re-create this with ghost Buttons stretched across a row.
   */
  interactive?: InteractiveAction
  /** Canonical selected treatment for rows; consumers manage the state. */
  selected?: boolean
}

/** Composition-friendly semantic row with canonical list spacing. */
export const ListRow = forwardRef<HTMLLIElement, ListRowProps>(function ListRow(
  { className, interactive, selected = false, children, ...props },
  ref,
) {
  const columns = useContext(ListRowsColumnsContext)
  return (
    <li
      ref={ref}
      {...props}
      data-slot="list-row"
      data-interactive={interactive ? '' : undefined}
      data-selected={selected ? '' : undefined}
      className={cn(
        'relative min-w-0 px-bakin-3 py-bakin-3',
        columns && [
          'grid gap-bakin-3',
          columnsTemplateClasses[columns.at],
          columnsAlignClasses[columns.at][columns.align],
        ],
        'data-[selected]:bg-bakin-action-primary-background/10',
        interactiveSurfaceClasses,
        className,
      )}
    >
      {interactive ? interactiveOverlay(interactive) : null}
      {children}
    </li>
  )
})

export type ListRowLabelsProps = ComponentPropsWithoutRef<'li'>

/**
 * Optional column-label row for a `columns` list. Renders one cell per track
 * and appears only while the shared template is active — below the breakpoint
 * rows stack and the labels would mislabel a vertical layout, so the row is
 * hidden entirely. It is `aria-hidden`: the labels are a visual scanning aid
 * that duplicates information every cell must already carry accessibly (see
 * `ListRowsProps.columns`), and a decorative row must not inflate the list's
 * item count or reading order.
 */
export const ListRowLabels = forwardRef<HTMLLIElement, ListRowLabelsProps>(
  function ListRowLabels({ className, ...props }, ref) {
    const columns = useContext(ListRowsColumnsContext)
    return (
      <li
        ref={ref}
        aria-hidden="true"
        {...props}
        data-slot="list-row-labels"
        className={cn(
          'hidden min-w-0 px-bakin-3 pb-bakin-1 pt-bakin-2',
          'text-[length:var(--bakin-typography-size-meta)] font-bakin-typography-weight-semibold uppercase tracking-[.12em] text-bakin-text-muted',
          columns && [
            'gap-bakin-3',
            labelsVisibleClasses[columns.at],
            columnsTemplateClasses[columns.at],
          ],
          className,
        )}
      />
    )
  },
)

export interface ListRowGroupProps extends ComponentPropsWithoutRef<'div'> {
  /** Group heading rendered above the group's rows. */
  label: ReactNode
}

/**
 * Section wrapper for date/section-grouped row lists (chat rail, plan lists,
 * calendar day lists): a small uppercase heading above one nested `ListRows`.
 *
 * Composition: a sibling wrapper — not a `groups` data prop — so every
 * `ListRows`/`ListRow` capability (variants, columns, arbitrary row content)
 * stays available inside each group without a parallel API. The unlabeled
 * nested `ListRows` is wired to the heading automatically via context +
 * `aria-labelledby`; an explicit `aria-label`/`aria-labelledby` on the list
 * wins.
 *
 * A11y anatomy: one labelled `<ul>` per group rather than a single list with
 * `role="group"` children or nested lists. Per-group labelled lists give
 * screen readers an accurate name and item count for each group ("Today,
 * list, 4 items"), whereas grouping roles inside lists have uneven AT support
 * and a single flat list would either miscount headings as items or lose them.
 */
export function ListRowGroup({ label, className, children, ...props }: ListRowGroupProps) {
  const labelId = useId()
  return (
    <div {...props} data-slot="list-row-group" className={cn('grid min-w-0 gap-bakin-1', className)}>
      <div
        id={labelId}
        data-slot="list-row-group-label"
        className="min-w-0 px-bakin-3 text-[length:var(--bakin-typography-size-meta)] font-bakin-typography-weight-semibold uppercase tracking-[.12em] text-bakin-text-muted"
      >
        {label}
      </div>
      <ListRowGroupLabelContext.Provider value={labelId}>
        {children}
      </ListRowGroupLabelContext.Provider>
    </div>
  )
}
