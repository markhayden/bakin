import * as React from 'react'

import { cn } from '../utils'

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

  return (
    <Component
      {...props}
      role={isToolbar ? 'toolbar' : undefined}
      aria-label={label}
      aria-labelledby={labelledBy}
      data-as={as}
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
      <div
        data-slot="page-controls-set"
        className="flex min-w-0 flex-1 flex-wrap items-center gap-bakin-3"
      >
        {children}
      </div>
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
    </Component>
  )
}
