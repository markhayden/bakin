import * as React from 'react'

import { cn } from '../utils'

export type KeyValueLayout = 'inline' | 'rows' | 'columns'

export interface KeyValueItem {
  /** Field name. Kept short — this is a label, not a sentence. */
  label: React.ReactNode
  /** Field value. `null`/`undefined` render as an em dash, never as blank. */
  value: React.ReactNode
  /** Renders the value in the mono family (ids, paths, raw names). */
  mono?: boolean
  /** Aligns digits so stacked numbers compare cleanly. */
  numeric?: boolean
  /** Lets a long value wrap mid-token instead of overflowing (paths, hashes). */
  breakValue?: boolean
}

export interface KeyValueProps extends Omit<React.ComponentPropsWithoutRef<'dl'>, 'children'> {
  items: ReadonlyArray<KeyValueItem>
  /**
   * `inline` wraps label/value pairs onto as few lines as fit — a compact meta
   * strip under a heading or inside a feed entry.
   * `rows` stacks one pair per row with the value pushed right and a rule
   * between rows — a readable list of fields.
   * `columns` puts labels in an aligned left column beside their values, and
   * collapses to stacked pairs on narrow containers.
   */
  layout?: KeyValueLayout
}

const VALUE_BASE = 'm-0 min-w-0 text-bakin-text-primary'

/**
 * Label/value pairs — the one contract for object metadata.
 *
 * Replaces per-surface `<dl>` grids, which had drifted to a different gap,
 * label color, and numeric alignment at nearly every call site. Values carry
 * meaning, so a missing one renders an em dash rather than collapsing the row
 * and silently changing what the reader is comparing.
 */
export function KeyValue({
  items,
  layout = 'rows',
  className,
  ...props
}: KeyValueProps) {
  const list = (
    <dl
      {...props}
      data-slot="key-value"
      data-layout={layout}
      className={cn(
        'm-0 min-w-0 text-[length:var(--bakin-typography-size-meta)]',
        layout === 'inline' && 'flex flex-wrap items-baseline gap-x-bakin-4 gap-y-bakin-1',
        layout === 'rows' && 'grid gap-y-bakin-1',
        layout === 'rows' && 'divide-y divide-bakin-border-subtle',
        // The container query must resolve against an ANCESTOR: an element can
        // never match a container it declares itself, so naming the container
        // here and querying it here left `columns` permanently single-column.
        // The wrapper below owns the container; this only reads it.
        layout === 'columns' && 'grid gap-x-bakin-4 gap-y-bakin-1 @sm/key-value:grid-cols-[max-content_minmax(0,1fr)]',
        className,
      )}
    >
      {items.map((item, index) => {
        const value = item.value === null || item.value === undefined ? '—' : item.value
        const valueClass = cn(
          VALUE_BASE,
          item.mono && 'font-bakin-typography-family-mono',
          item.numeric && 'tabular-nums',
          item.breakValue && 'break-all',
        )

        if (layout === 'columns') {
          return (
            <React.Fragment key={index}>
              <dt className="text-bakin-text-muted">{item.label}</dt>
              <dd className={valueClass}>{value}</dd>
            </React.Fragment>
          )
        }

        return (
          <div
            key={index}
            data-slot="key-value-pair"
            className={cn(
              'flex min-w-0 gap-bakin-2',
              layout === 'inline' && 'items-baseline',
              layout === 'rows' && 'items-baseline justify-between',
              layout === 'rows' && 'pt-bakin-1 first:pt-0',
            )}
          >
            <dt className="shrink-0 text-bakin-text-muted">{item.label}</dt>
            <dd className={cn(valueClass, layout === 'rows' && 'text-right')}>{value}</dd>
          </div>
        )
      })}
    </dl>
  )

  // `columns` needs an ancestor container to size against; the other layouts
  // are flow-based and must not introduce a containment boundary.
  return layout === 'columns'
    ? <div data-slot="key-value-container" className="@container/key-value min-w-0">{list}</div>
    : list
}
