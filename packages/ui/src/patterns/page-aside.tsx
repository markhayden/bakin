'use client'

import * as React from 'react'

import { Button } from '../primitives/button'
import { cn } from '../utils'

type AccessibleAsideName =
  | { label: string; labelledBy?: never }
  | { label?: never; labelledBy: string }

type NativeAsideProps = Omit<
  React.ComponentPropsWithoutRef<'aside'>,
  'aria-label' | 'aria-labelledby'
>

/**
 * Named width presets for the collapsible rail: `nav` (app navigation),
 * `session` (session-manager lists) or `conversation` (a docked chat thread).
 */
export type PageAsideWidth = 'nav' | 'session' | 'conversation'

/** Which page edge a collapsible rail sits on. */
export type PageAsideSide = 'start' | 'end'

// Rail widths are the layout.size.rail* tokens — never raw scale values.
const RAIL_WIDTHS: Record<PageAsideWidth, string> = {
  nav: 'w-[var(--bakin-layout-size-rail-nav)]',
  session: 'w-[var(--bakin-layout-size-rail-session)]',
  conversation: 'w-[var(--bakin-layout-size-rail-conversation)]',
}
const RAIL_STRIP_WIDTH = 'w-[var(--bakin-layout-size-rail-strip)]'

export interface PageAsideCollapsible {
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  /**
   * What the collapsed rail shows. `strip` (default) replaces the children
   * with the kit's expand strip — the one expand affordance plus optional
   * `strip` content. `content` keeps the children mounted at the collapsed
   * width for asides that own an icon-mode rendering (app navigation).
   */
  collapsedMode?: 'strip' | 'content'
  /** Accessible name for the strip's expand control. */
  expandLabel?: string
  /** Extra strip content under the expand control (icon shortcuts). */
  strip?: React.ReactNode
}

export type PageAsideProps = NativeAsideProps
  & AccessibleAsideName
  & {
    /**
     * Collapsible rail mode: a full-height, fixed-width edge column that
     * collapses to the kit strip width. Without it, PageAside is the
     * reflow content aside (below content on narrow, right column wide).
     */
    collapsible?: PageAsideCollapsible
    /** Expanded rail width preset; only meaningful with `collapsible`. */
    width?: PageAsideWidth
    /** Rail edge; `end` docks it after the content (e.g. a conversation). Only meaningful with `collapsible`. */
    side?: PageAsideSide
  }

function ExpandIcon({ side }: { side: PageAsideSide }) {
  // Drawn for a start-edge rail; an end rail mirrors it so the arrow points into the page.
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={cn('size-bakin-4 fill-none stroke-current stroke-2', side === 'end' && '-scale-x-100')}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" strokeLinecap="round" />
      <path d="m13 9 3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Persisted collapse state for a collapsible aside. Storage failures never
 * break the toggle; the key names the surface (one key per rail).
 */
export function useCollapsedAside(storageKey: string): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsed] = React.useState(() => {
    try {
      return localStorage.getItem(storageKey) === 'true'
    } catch {
      return false
    }
  })
  const set = React.useCallback(
    (value: boolean) => {
      setCollapsed(value)
      try {
        localStorage.setItem(storageKey, String(value))
      } catch {
        // Persistence failures never break the toggle.
      }
    },
    [storageKey],
  )
  return [collapsed, set]
}

/**
 * Named supporting context. Default: reflows below the primary page content.
 * With `collapsible`: a full-height edge rail (session lists, app
 * navigation) that collapses to the kit strip — the ONE collapsible-rail
 * treatment; never hand-roll a strip or rail widths.
 */
export function PageAside({
  children,
  className,
  collapsible,
  label,
  labelledBy,
  width = 'session',
  side = 'start',
  ...props
}: PageAsideProps) {
  if (!collapsible) {
    return (
      <aside
        data-slot="page-aside"
        {...props}
        aria-label={label}
        aria-labelledby={labelledBy}
        className={cn(
          'flex min-w-0 flex-col gap-bakin-4 border-t border-bakin-border-subtle pt-bakin-6 @3xl/layout-grid:border-l @3xl/layout-grid:border-t-0 @3xl/layout-grid:pl-bakin-6 @3xl/layout-grid:pt-bakin-0',
          className,
        )}
      >
        {children}
      </aside>
    )
  }

  const { collapsed, onCollapsedChange, collapsedMode = 'strip', expandLabel, strip } = collapsible
  const showStrip = collapsed && collapsedMode === 'strip'
  return (
    <aside
      data-slot="page-aside"
      data-rail=""
      data-collapsed={collapsed ? '' : undefined}
      data-side={side === 'end' ? 'end' : undefined}
      {...props}
      aria-label={label}
      aria-labelledby={labelledBy}
      className={cn(
        'flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-bakin-border-subtle',
        side === 'end' ? 'border-l' : 'border-r',
        'transition-[width] duration-[var(--bakin-motion-duration-transition)] ease-bakin-standard motion-reduce:transition-none',
        collapsed ? RAIL_STRIP_WIDTH : RAIL_WIDTHS[width],
        className,
      )}
    >
      {showStrip ? (
        <div data-slot="page-aside-strip" className="flex min-h-0 flex-1 flex-col items-center gap-bakin-1 py-bakin-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={expandLabel ?? (label ? `Expand ${label.toLowerCase()}` : 'Expand')}
            aria-expanded={false}
            onClick={() => onCollapsedChange(false)}
            className="text-bakin-text-muted"
          >
            <ExpandIcon side={side} />
          </Button>
          {strip}
        </div>
      ) : (
        children
      )}
    </aside>
  )
}
