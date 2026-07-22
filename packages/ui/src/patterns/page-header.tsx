import * as React from 'react'

import { cn } from '../utils'

type NativePageHeaderProps = Omit<
  React.ComponentPropsWithoutRef<'header'>,
  'aria-describedby' | 'children' | 'title'
>

export interface PageHeaderProps extends NativePageHeaderProps {
  /** Accessible label for the grouped page actions. */
  actionsLabel?: string
  /** Primary actions for this page. Keep one action visually primary. */
  actions?: React.ReactNode
  /** Search, view selection, or other compact page-level controls before actions. */
  controls?: React.ReactNode
  /** Accessible label for the grouped page controls. */
  controlsLabel?: string
  /** Short supporting copy that explains the page's purpose. */
  description?: React.ReactNode
  /** Optional compact context above the title, such as a domain and page type. */
  eyebrow?: React.ReactNode
  /** Stable identifiers, status, or other compact page metadata. */
  meta?: React.ReactNode
  /** Client-routed back link or breadcrumb supplied by the consumer. */
  navigation?: React.ReactNode
  /** The page's single level-one heading. */
  title: React.ReactNode
}

/** Shared page identity and action hierarchy for every browser page recipe. */
export function PageHeader({
  actions,
  actionsLabel = 'Page actions',
  className,
  controls,
  controlsLabel = 'Page controls',
  description,
  eyebrow,
  meta,
  navigation,
  title,
  ...props
}: PageHeaderProps) {
  const descriptionId = React.useId()

  return (
    <header
      {...props}
      aria-describedby={description ? descriptionId : undefined}
      data-slot="page-header"
      className={cn(
        '@container/page-header grid min-w-0 gap-bakin-3 font-bakin-typography-family-ui text-bakin-text-primary',
        className,
      )}
    >
      {navigation ? (
        <div
          data-slot="page-header-navigation"
          className="min-w-0 [overflow-wrap:anywhere] text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted [&_a]:text-bakin-text-primary [&_a]:underline-offset-4 [&_a:hover]:underline"
        >
          {navigation}
        </div>
      ) : null}

      <div
        data-slot="page-header-layout"
        className="grid min-w-0 gap-bakin-3 @3xl/page-header:grid-cols-[minmax(0,1fr)_auto]"
      >
        {eyebrow ? (
          <p
            data-slot="page-header-eyebrow"
            className="m-0 min-w-0 [overflow-wrap:anywhere] text-[length:var(--bakin-typography-size-meta)] font-bakin-typography-weight-bold uppercase tracking-[.12em] text-bakin-signal-accent"
          >
            {eyebrow}
          </p>
        ) : null}

        <div
          data-slot="page-header-copy"
          className="grid min-w-0 max-w-3xl gap-bakin-2 @3xl/page-header:col-start-1"
        >
          <h1
            data-slot="page-header-title"
            className="m-0 max-w-[24ch] [overflow-wrap:anywhere] text-[length:var(--bakin-typography-size-page-title)] font-bakin-typography-weight-bold leading-[1.02] tracking-[-.04em] text-bakin-text-primary"
          >
            {title}
          </h1>
          {description ? (
            <p
              id={descriptionId}
              data-slot="page-header-description"
              className="m-0 max-w-prose [overflow-wrap:anywhere] text-[length:var(--bakin-typography-size-body)] leading-relaxed text-bakin-text-muted"
            >
              {description}
            </p>
          ) : null}
        </div>

        {meta ? (
          <div
            data-slot="page-header-meta"
            className="flex min-w-0 flex-wrap items-center gap-x-bakin-3 gap-y-bakin-2 [overflow-wrap:anywhere] text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted @3xl/page-header:col-start-1"
          >
            {meta}
          </div>
        ) : null}

        {controls || actions ? (
          <div
            data-slot="page-header-trailing"
            className="flex w-full min-w-0 flex-col items-stretch gap-bakin-3 @3xl/page-header:col-start-2 @3xl/page-header:row-start-1 @3xl/page-header:ml-auto @3xl/page-header:w-auto @3xl/page-header:flex-row @3xl/page-header:flex-nowrap @3xl/page-header:items-start"
          >
            {controls ? (
              <div
                role="group"
                aria-label={controlsLabel}
                data-slot="page-header-controls"
                className="flex min-w-0 flex-col items-stretch gap-bakin-2 @sm/page-header:flex-row @sm/page-header:items-center @3xl/page-header:flex-nowrap @3xl/page-header:[&>[data-segmented-control]]:shrink-0 @3xl/page-header:[&>[data-slot=search-input-reserve]]:w-[22rem] @3xl/page-header:[&>[data-slot=search-input-reserve]]:shrink-0"
              >
                {controls}
              </div>
            ) : null}
            {actions ? (
              <div
                role="group"
                aria-label={actionsLabel}
                data-slot="page-header-actions"
                className="flex min-w-0 shrink-0 flex-col items-stretch gap-bakin-2 @sm/page-header:flex-row @sm/page-header:items-center [&>[data-slot=button]]:w-full @sm/page-header:[&>[data-slot=button]]:w-auto"
              >
                {actions}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  )
}
