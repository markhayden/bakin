'use client'

import * as React from 'react'

import { PageShell, type PageShellProps } from '../layout/page-shell'
import { cn } from '../utils'

export type PageWidth = 'standard' | 'full'
export type PageScroll = 'page' | 'contained'
export type PageDensity = 'default' | 'compact'

export type PageProps = Omit<PageShellProps, 'children' | 'gap' | 'padding' | 'width'> & {
  children: React.ReactNode
  /**
   * Compact carries the workflow workspace's canvas-density contribution —
   * the tighter PageShell padding scale plus the content gap — for graph,
   * board, and action workspaces that need more working room.
   */
  density?: PageDensity
  /**
   * Page uses host document scrolling; contained bounds the page to its
   * owning pane so named child regions (PageTimeline, canvases) own scrolling.
   */
  scroll?: PageScroll
  /** Full uses the available plugin canvas; standard is the bounded content measure for focused documents. */
  width?: PageWidth
}

/**
 * Scroll ownership shared with slot components: PageTimeline reads this to
 * become the page's one internal scroller only inside a contained Page.
 */
export const PageScrollContext = React.createContext<PageScroll>('page')

const widthMap: Record<PageWidth, PageShellProps['width']> = {
  standard: 'content',
  full: 'full',
}

/**
 * Contained scroll ownership. Taken from the retired detail archetype's
 * `scroll="contained"` implementation rather than the conversation one: it
 * additionally sets `min-h-0` and `overflow-hidden` on both the shell root
 * and the shell content, so a contained page can genuinely shrink inside a
 * height-bound flex parent and never leaks a document-level scrollbar when an
 * inner pane overflows — the `h-full`-only variant relied on every child
 * bounding itself.
 */
const containedClasses =
  'h-full min-h-0 overflow-hidden [&>[data-slot=page-shell-content]]:h-full [&>[data-slot=page-shell-content]]:min-h-0 [&>[data-slot=page-shell-content]]:shrink [&>[data-slot=page-shell-content]]:overflow-hidden'

/**
 * The one page archetype. Owns the page canvas (width measure, density,
 * scroll ownership) for lists, details, settings, dashboards, conversations,
 * and workflow workspaces; WorkspacePage remains the only other archetype.
 */
export function Page({
  children,
  className,
  density = 'default',
  scroll = 'page',
  width = 'full',
  ...props
}: PageProps) {
  return (
    <PageScrollContext.Provider value={scroll}>
      <PageShell
        {...props}
        className={cn(scroll === 'contained' && containedClasses, className)}
        data-archetype="page"
        data-density={density}
        data-scroll={scroll}
        gap={density === 'compact' ? 'content' : 'page'}
        padding={density === 'compact' ? 'compact' : 'default'}
        width={widthMap[width]}
      >
        {children}
      </PageShell>
    </PageScrollContext.Provider>
  )
}
