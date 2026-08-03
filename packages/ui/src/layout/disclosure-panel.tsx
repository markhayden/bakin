import * as React from 'react'

import { layoutClassName } from './utils'

export interface DisclosurePanelProps
  extends Omit<React.ComponentPropsWithRef<'details'>, 'title'> {
  /** The always-visible summary row content. */
  summary: React.ReactNode
  /** Compact trailing content on the summary row (counts, badges). */
  summaryMeta?: React.ReactNode
}

/**
 * A bounded panel that opens on demand: native `<details>` semantics with the
 * kit's surface paint, one summary-row treatment, and a rotating indicator.
 * Use for secondary regions a page reveals in place — never for overlays.
 */
export function DisclosurePanel({
  children,
  className,
  summary,
  summaryMeta,
  ...props
}: DisclosurePanelProps) {
  return (
    <details
      {...props}
      data-slot="disclosure-panel"
      className={layoutClassName(
        'group/disclosure-panel min-w-0 overflow-hidden rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default',
        className,
      )}
    >
      <summary
        data-slot="disclosure-panel-summary"
        className="flex min-w-0 cursor-pointer list-none items-center justify-between gap-bakin-3 px-bakin-4 py-bakin-3 font-bakin-typography-weight-semibold text-bakin-text-primary outline-none [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-bakin-focus-ring"
      >
        <span className="min-w-0 [overflow-wrap:anywhere]">{summary}</span>
        <span className="flex shrink-0 items-center gap-bakin-2 text-[length:var(--bakin-typography-size-meta)] font-bakin-typography-weight-regular text-bakin-text-muted">
          {summaryMeta}
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-bakin-4 shrink-0 fill-none stroke-current stroke-[1.5] transition-transform group-open/disclosure-panel:rotate-180 motion-reduce:transition-none"
          >
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </summary>
      <div
        data-slot="disclosure-panel-content"
        className="min-w-0 border-t border-bakin-border-subtle px-bakin-4 py-bakin-3"
      >
        {children}
      </div>
    </details>
  )
}
