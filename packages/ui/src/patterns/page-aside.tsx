'use client'

import * as React from 'react'

import { ResizeHandle } from '../behaviors/resize-handle'
import { usePersistedLeadingEdgeResize } from '../behaviors/use-persisted-leading-edge-resize'
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
// The same presets in px for a resizable rail's starting width — the
// reference.size.rail* tokens at 16px root (pinned by tests/ui/patterns/page-aside-rail).
const RAIL_DEFAULT_PX: Record<PageAsideWidth, number> = { nav: 208, session: 288, conversation: 360 }
const RESIZABLE_WIDTH = 'w-[var(--bakin-aside-width)]'
// Until the row is measured, the persisted width is only a preference: keep half the row for the page.
const UNMEASURED_CAP = 'max-w-[50%]'
const RAIL_MIN_WIDTH = 200
const RAIL_MAX_WIDTH = 720
const ASIDE_WIDTH_STORAGE_KEY = 'bakin-aside-width'

/**
 * Width of the rail's flex row, observed so the effective maximum follows
 * the space actually available; `null` until the first measurement (or
 * where ResizeObserver does not exist).
 */
function useRowWidth(ref: React.RefObject<HTMLElement | null>, enabled: boolean): number | null {
  const [width, setWidth] = React.useState<number | null>(null)
  React.useEffect(() => {
    const row = ref.current?.parentElement
    if (!enabled || !row || typeof ResizeObserver === 'undefined') {
      setWidth(null)
      return
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(row)
    return () => observer.disconnect()
  }, [enabled, ref])
  return width
}

/**
 * Drag-to-resize for a collapsible rail: the kit grab bar on the rail's
 * page-facing edge, keyboard-operable (arrows, Home, End), the width
 * persisted per `storageKey`. The expanded width starts at the `width`
 * preset and stays inside `[minWidth, maxWidth]` (200–720px by default).
 * Once the row is measured, half of it is the ceiling (the minimum yields to
 * it too; a CSS cap covers the first paint), so a width saved on a wide
 * screen cannot crush the page on a narrow one — the saved preference
 * itself is kept for a wider screen.
 */
export interface PageAsideResizable {
  /** Names the surface; the width persists under it (one key per rail). */
  storageKey: string
  minWidth?: number
  maxWidth?: number
}

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
    /** Let the user drag the rail's page-facing edge; only meaningful with `collapsible`. */
    resizable?: PageAsideResizable
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
  resizable,
  ...props
}: PageAsideProps) {
  const collapsed = collapsible?.collapsed ?? false
  const asideRef = React.useRef<HTMLElement>(null)
  const resizing = Boolean(resizable) && Boolean(collapsible) && !collapsed
  const rowWidth = useRowWidth(asideRef, resizing)
  // Half the row is the ceiling once measured — and the floor yields to it
  // too, so in a row too narrow for twice the minimum the rendered width,
  // the CSS variable and the accessible values still agree (nothing to drag).
  const effectiveMax = rowWidth === null
    ? resizable?.maxWidth ?? RAIL_MAX_WIDTH
    : Math.min(resizable?.maxWidth ?? RAIL_MAX_WIDTH, Math.floor(rowWidth / 2))
  const minWidth = Math.min(resizable?.minWidth ?? RAIL_MIN_WIDTH, effectiveMax)
  // An end rail's page-facing edge is its leading (left) edge; a start rail's is its trailing edge.
  const resize = usePersistedLeadingEdgeResize({
    axis: 'x',
    edge: side === 'end' ? 'leading' : 'trailing',
    defaultSize: RAIL_DEFAULT_PX[width],
    minSize: minWidth,
    maxSize: effectiveMax,
    storageKey: resizable ? `${ASIDE_WIDTH_STORAGE_KEY}:${resizable.storageKey}` : undefined,
    disabled: !resizable || !collapsible || collapsed,
  })
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

  const { onCollapsedChange, collapsedMode = 'strip', expandLabel, strip } = collapsible
  const showStrip = collapsed && collapsedMode === 'strip'
  const dragging = resize.handleProps['data-resizing']
  return (
    <aside
      ref={asideRef}
      data-slot="page-aside"
      data-rail=""
      data-collapsed={collapsed ? '' : undefined}
      data-side={side === 'end' ? 'end' : undefined}
      data-resizing={dragging ? '' : undefined}
      {...props}
      aria-label={label}
      aria-labelledby={labelledBy}
      style={resizing ? { ...props.style, '--bakin-aside-width': `${resize.size}px` } as React.CSSProperties : props.style}
      className={cn(
        'relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-bakin-border-subtle',
        side === 'end' ? 'border-l' : 'border-r',
        // The width animates for collapse/expand, never under the pointer.
        dragging ? 'transition-none' : 'transition-[width] duration-[var(--bakin-motion-duration-transition)] ease-bakin-standard motion-reduce:transition-none',
        collapsed ? RAIL_STRIP_WIDTH : resizing ? cn(RESIZABLE_WIDTH, rowWidth === null && UNMEASURED_CAP) : RAIL_WIDTHS[width],
        className,
      )}
    >
      {resizing ? (
        <ResizeHandle
          orientation="vertical"
          handleProps={resize.handleProps}
          label={label ? `Resize ${label.toLowerCase()}` : 'Resize panel'}
          visibleAtRest
          className={cn('absolute inset-y-0 z-10 flex w-bakin-2 cursor-col-resize', side === 'end' ? 'left-0' : 'right-0')}
        />
      ) : null}
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
