import * as React from 'react'

import { cn } from '../utils'
import { FilterIndicator, FilterIndicatorContext } from './filter-indicator'

export type PageControlsAs = 'section' | 'toolbar'

type AccessibleRegionName =
  | { label: string; labelledBy?: never }
  | { label?: never; labelledBy: string }

type NativeControlsProps = Omit<
  React.ComponentPropsWithoutRef<'section'>,
  'aria-label' | 'aria-labelledby' | 'children' | 'role'
>

export type PageControlsProps = NativeControlsProps & AccessibleRegionName & {
  /** Optional peer actions such as clearing every active filter. */
  actions?: React.ReactNode
  /**
   * Section (default) is a named wrapping control region for search, filters,
   * and view state; toolbar is the ARIA toolbar contract for command rows
   * such as graph tools.
   */
  as?: PageControlsAs
  /** Filters own one leading indicator; nested AgentFilters omit theirs. Generic controls stay unchanged. */
  variant?: 'default' | 'filters'
  /** Search, filters, view controls, and commands supplied by the consumer. */
  children: React.ReactNode
  /**
   * Structural divider per the merged originals: sections stay borderless by
   * default and opt into a top divider only when controls begin a genuinely
   * separate page zone; toolbars keep their bottom divider by default.
   */
  divider?: boolean
}

/** Named control region or ARIA toolbar. URL state remains owned by the consuming page. */
export function PageControls({
  actions,
  as = 'section',
  variant = 'default',
  children,
  className,
  divider,
  label,
  labelledBy,
  ...props
}: PageControlsProps) {
  const isToolbar = as === 'toolbar'
  const showDivider = divider ?? isToolbar
  const Component = isToolbar ? 'div' : 'section'
  const parentOwnsIndicator = React.useContext(FilterIndicatorContext)
  const ownsIndicator = variant === 'filters' && !parentOwnsIndicator
  const controls = (
    <div data-slot="page-controls-set" className="flex min-w-0 flex-1 flex-wrap items-center gap-bakin-3">
      {children}
    </div>
  )

  return (
    <Component
      {...props}
      role={isToolbar ? 'toolbar' : undefined}
      aria-label={label}
      aria-labelledby={labelledBy}
      data-as={as}
      data-variant={variant}
      data-divider={showDivider ? 'true' : 'false'}
      data-slot="page-controls"
      className={cn(
        isToolbar
          ? 'flex min-w-0 flex-wrap items-center gap-bakin-3'
          : 'flex min-w-0 flex-col items-stretch gap-bakin-3 @lg/page-shell:flex-row @lg/page-shell:items-center',
        showDivider
          && (isToolbar
            ? 'border-b border-bakin-border-subtle pb-bakin-4'
            : 'border-t border-bakin-border-subtle pt-bakin-4'),
        className,
      )}
    >
      <FilterIndicatorContext.Provider value={parentOwnsIndicator || ownsIndicator}>
        {ownsIndicator ? (
          <div data-slot="page-controls-filters" className="flex min-w-0 flex-1 items-start gap-bakin-3">
            <span className="inline-flex h-[var(--bakin-layout-size-control)] shrink-0 items-center">
              <FilterIndicator />
            </span>
            {controls}
          </div>
        ) : controls}
        {actions ? (
          <div
            data-slot="page-controls-actions"
            className={cn(
              'flex min-w-0 flex-wrap items-center gap-bakin-2',
              isToolbar ? 'ml-auto' : '@lg/page-shell:ml-auto',
            )}
          >
            {actions}
          </div>
        ) : null}
      </FilterIndicatorContext.Provider>
    </Component>
  )
}
