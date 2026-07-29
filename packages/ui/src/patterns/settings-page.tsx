import * as React from 'react'

import { PageShell, type PageShellProps } from '../layout/page-shell'
import { cn } from '../utils'

export type SettingsPageWidth = 'content' | 'wide' | 'full'
export type SettingsPageLayout = 'single' | 'navigation'

export type SettingsPageProps = Omit<PageShellProps, 'children' | 'gap' | 'padding' | 'width'> & {
  children: React.ReactNode
  /** Content suits one focused form; wide supports navigation; full supports plugin-wide configuration. */
  width?: SettingsPageWidth
}

/** Page canvas for system, account, plugin, or resource configuration. */
export function SettingsPage({ children, width = 'wide', ...props }: SettingsPageProps) {
  return (
    <PageShell {...props} data-archetype="settings" width={width}>
      {children}
    </PageShell>
  )
}

export type SettingsPageBodyProps = Omit<React.ComponentPropsWithoutRef<'div'>, 'children'> & {
  children: React.ReactNode
  /** Single-column form flow or category navigation with one active form region. */
  layout?: SettingsPageLayout
}

/** Responsive settings frame. The selected category remains consumer-owned URL state. */
export function SettingsPageBody({
  children,
  className,
  layout = 'single',
  ...props
}: SettingsPageBodyProps) {
  return (
    <div data-slot="settings-page-container" className="@container/settings-page min-w-0">
      <div
        {...props}
        data-layout={layout}
        data-slot="settings-page-grid"
        className={cn(
          'grid min-w-0 items-start gap-bakin-6',
          layout === 'navigation'
            && '@3xl/settings-page:grid-cols-[minmax(12rem,.42fr)_minmax(0,1.58fr)] @3xl/settings-page:gap-bakin-8',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

type AccessibleRegionName =
  | { label: string; labelledBy?: never }
  | { label?: never; labelledBy: string }

type NativeNavigationProps = Omit<
  React.ComponentPropsWithoutRef<'nav'>,
  'aria-label' | 'aria-labelledby'
>

export type SettingsPageNavigationProps = NativeNavigationProps & AccessibleRegionName

/** Named category navigation that reflows above the active form at narrow widths. */
export function SettingsPageNavigation({
  className,
  label,
  labelledBy,
  ...props
}: SettingsPageNavigationProps) {
  return (
    <nav
      {...props}
      aria-label={label}
      aria-labelledby={labelledBy}
      data-slot="settings-page-navigation"
      className={cn(
        'flex min-w-0 flex-row flex-wrap items-stretch gap-bakin-2 border-b border-bakin-border-subtle pb-bakin-4',
        '@3xl/settings-page:flex-col @3xl/settings-page:border-b-0 @3xl/settings-page:border-r @3xl/settings-page:pb-bakin-0 @3xl/settings-page:pr-bakin-6',
        className,
      )}
    />
  )
}

type NativeContentProps = Omit<
  React.ComponentPropsWithoutRef<'section'>,
  'aria-busy' | 'aria-label' | 'aria-labelledby' | 'children'
>

export type SettingsPageContentProps = NativeContentProps & AccessibleRegionName & {
  /** Marks a refresh or submit while retained settings remain visible. */
  busy?: boolean
  children?: React.ReactNode
  /** Persistent validation, dirty, save, or provider context retained with the form. */
  feedback?: React.ReactNode
  /** Loading, empty, error, or permission state that replaces only the active category. */
  state?: React.ReactNode
}

/** Named active settings region with retained-feedback and replacement-state slots. */
export function SettingsPageContent({
  busy = false,
  children,
  className,
  feedback,
  label,
  labelledBy,
  state,
  ...props
}: SettingsPageContentProps) {
  const hasState = state !== undefined && state !== null

  return (
    <section
      {...props}
      aria-busy={busy || undefined}
      aria-label={label}
      aria-labelledby={labelledBy}
      data-content-state={hasState ? 'replaced' : 'ready'}
      data-slot="settings-page-content"
      className={cn('flex min-w-0 flex-col gap-bakin-6', className)}
    >
      {feedback ? <div data-slot="settings-page-feedback">{feedback}</div> : null}
      {hasState ? <div data-slot="settings-page-state">{state}</div> : children}
    </section>
  )
}
