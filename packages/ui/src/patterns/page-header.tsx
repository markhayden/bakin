import * as React from 'react'

import { Button } from '../primitives/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu'
import { cn } from '../utils'

type NativePageHeaderProps = Omit<
  React.ComponentPropsWithoutRef<'header'>,
  'aria-describedby' | 'children' | 'title'
>

export type PageHeaderMeasure = 'standard' | 'wide'

export interface PageHeaderOverflowMenuProps {
  /** Menu items rendered in the page-level overflow menu. */
  children: React.ReactNode
  /** Accessible name for the circular overflow trigger. */
  label?: string
}

/** Shared circular overflow trigger for detail headers that cannot use PageHeader directly. */
export function PageHeaderOverflowMenu({
  children,
  label = 'More actions',
}: PageHeaderOverflowMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="ml-auto rounded-bakin-pill"
            aria-label={label}
            title={label}
          />
        )}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="size-bakin-4 fill-current"
        >
          <circle cx="3" cy="8" r="1.25" />
          <circle cx="8" cy="8" r="1.25" />
          <circle cx="13" cy="8" r="1.25" />
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

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
  /** Standard preserves a readable title measure; wide follows media/editor primary-column breadth. */
  measure?: PageHeaderMeasure
  /** Client-routed back link or breadcrumb supplied by the consumer. */
  navigation?: React.ReactNode
  /** Secondary page actions shown from the context-row overflow menu. */
  overflowActions?: React.ReactNode
  /** Accessible name for the context-row overflow menu trigger. */
  overflowActionsLabel?: string
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
  measure = 'standard',
  navigation,
  overflowActions,
  overflowActionsLabel = 'More actions',
  title,
  ...props
}: PageHeaderProps) {
  const descriptionId = React.useId()
  const hasContext = Boolean(navigation || eyebrow || overflowActions)

  return (
    <header
      {...props}
      aria-describedby={description ? descriptionId : undefined}
      data-measure={measure}
      data-slot="page-header"
      className={cn(
        '@container/page-header grid min-w-0 gap-bakin-3 font-bakin-typography-family-ui text-bakin-text-primary',
        className,
      )}
    >
      <div
        data-slot="page-header-layout"
        className="grid min-w-0 gap-bakin-3 @3xl/page-header:grid-cols-[minmax(0,1fr)_auto]"
      >
        {hasContext ? (
          <div
            data-slot="page-header-context"
            className="flex min-w-0 items-center gap-bakin-2 @3xl/page-header:col-span-2"
          >
            <div
              data-slot="page-header-context-copy"
              className="flex min-w-0 flex-1 flex-wrap items-center gap-bakin-2"
            >
              {navigation ? (
                <div
                  data-slot="page-header-navigation"
                  className="min-w-0 shrink-0 [overflow-wrap:anywhere] text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted [&_a]:text-bakin-text-primary [&_a]:underline-offset-4 [&_a:hover]:underline"
                >
                  {navigation}
                </div>
              ) : null}
              {eyebrow ? (
                <p
                  data-slot="page-header-eyebrow"
                  className="m-0 min-w-0 [overflow-wrap:anywhere] text-[length:var(--bakin-typography-size-meta)] font-bakin-typography-weight-bold uppercase tracking-[.12em] text-bakin-signal-accent"
                >
                  {eyebrow}
                </p>
              ) : null}
            </div>
            {overflowActions ? (
              <PageHeaderOverflowMenu label={overflowActionsLabel}>
                {overflowActions}
              </PageHeaderOverflowMenu>
            ) : null}
          </div>
        ) : null}

        <div
          data-slot="page-header-copy"
          className={cn(
            'grid min-w-0 gap-bakin-2 @3xl/page-header:col-start-1',
            measure === 'standard'
              ? 'max-w-none @3xl/page-header:max-w-[50cqw]'
              : 'max-w-none',
          )}
        >
          <h1
            data-slot="page-header-title"
            className={cn(
              'm-0 [overflow-wrap:anywhere] text-[length:var(--bakin-typography-size-page-title)] font-bakin-typography-weight-bold leading-[1.02] tracking-[-.04em] text-bakin-text-primary',
              measure === 'standard' ? 'max-w-[30ch]' : 'max-w-none',
            )}
          >
            {title}
          </h1>
          {description ? (
            <p
              id={descriptionId}
              data-slot="page-header-description"
              className={cn(
                'm-0 [overflow-wrap:anywhere] text-[length:var(--bakin-typography-size-body)] leading-relaxed text-bakin-text-muted',
                'max-w-none',
              )}
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
            className={cn(
              'flex w-full min-w-0 flex-col items-stretch gap-bakin-3 @3xl/page-header:col-start-2 @3xl/page-header:ml-auto @3xl/page-header:w-auto @3xl/page-header:flex-row @3xl/page-header:flex-nowrap @3xl/page-header:items-start',
              hasContext
                ? '@3xl/page-header:row-start-2'
                : '@3xl/page-header:row-start-1',
            )}
          >
            {controls ? (
              <div
                role="group"
                aria-label={controlsLabel}
                data-slot="page-header-controls"
                className="flex min-w-0 flex-col items-stretch gap-bakin-2 @lg/page-header:flex-row @lg/page-header:items-center @3xl/page-header:flex-nowrap @3xl/page-header:[&>[data-segmented-control]]:shrink-0 @3xl/page-header:[&>[data-slot=search-input-reserve]]:w-[22rem] @3xl/page-header:[&>[data-slot=search-input-reserve]]:shrink-0"
              >
                {controls}
              </div>
            ) : null}
            {actions ? (
              <div
                role="group"
                aria-label={actionsLabel}
                data-slot="page-header-actions"
                className="flex min-w-0 shrink-0 flex-col items-stretch gap-bakin-2 @lg/page-header:flex-row @lg/page-header:items-center [&>[data-slot=button]:not([data-size^=icon])]:w-full @lg/page-header:[&>[data-slot=button]:not([data-size^=icon])]:w-auto"
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
