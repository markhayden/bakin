import * as React from 'react'

import { PageShell, type PageShellProps } from '../layout/page-shell'
import { cn } from '../utils'
import { PageHeaderOverflowMenu } from './page-header'

export type WorkspacePageMode = 'contained' | 'immersive'

const WorkspacePageContext = React.createContext<{
  mode: WorkspacePageMode
  flow: boolean
}>({ mode: 'contained', flow: false })

export type WorkspacePageProps = Omit<
  PageShellProps,
  'children' | 'gap' | 'padding' | 'width'
> & {
  children: React.ReactNode
  /**
   * Immersive workspaces let the full identity scroll away on EVERY
   * viewport, retain a compact sticky context row, and give the remaining
   * viewport to the canvas. `contained` keeps the identity pinned with the
   * body owning all scrolling.
   */
  mode?: WorkspacePageMode
  /**
   * Document-flow workspace: the body grows with its content and the page
   * owns the ONE vertical scroll (identity + content scroll as a single
   * document; the compact row still sticks). The body still fills the
   * remaining viewport as a MINIMUM, so a trailing canvas (board, grid)
   * reaches the fold and pinned affordances such as a sticky horizontal
   * scrollbar sit at the window bottom even when content is short.
   * Default keeps the viewport-bound canvas whose children own their
   * scrolling.
   */
  flow?: boolean
}

/**
 * Full-bleed page geometry for persistent application workspaces.
 *
 * The header and body subpatterns deliberately own all insets. Ordinary
 * list, detail, settings, and dashboard pages should continue to use their
 * focused page recipes.
 */
export function WorkspacePage({
  children,
  className,
  flow = false,
  mode = 'contained',
  ...props
}: WorkspacePageProps) {
  const context = React.useMemo(() => ({ mode, flow }), [mode, flow])
  return (
    <WorkspacePageContext.Provider value={context}>
      <PageShell
        {...props}
        className={cn(
          'h-full [--bakin-workspace-compact-header-height:3.5rem]',
          // Flow lets the content box GROW past the shell so sticky children
          // hold against the whole document; bounded canvases pin it to the
          // shell height so percentage-height bodies resolve.
          flow ? undefined : '[&>[data-slot=page-shell-content]]:h-full',
          mode === 'immersive'
            ? 'overflow-y-auto overscroll-y-contain'
            : 'overflow-hidden',
          className,
        )}
        data-archetype="workspace"
        data-mode={mode}
        gap="none"
        padding="none"
        width="full"
      >
        {children}
      </PageShell>
    </WorkspacePageContext.Provider>
  )
}

export type WorkspacePageHeaderProps = React.ComponentPropsWithoutRef<'div'>

/** Canonically inset page identity and controls above a full-bleed workspace. */
export function WorkspacePageHeader({
  className,
  ...props
}: WorkspacePageHeaderProps) {
  const { mode } = React.useContext(WorkspacePageContext)

  return (
    <div
      {...props}
      data-slot="workspace-page-header"
      className={cn(
        'min-w-0 shrink-0 px-bakin-4 pt-bakin-4 pb-bakin-4 @md/page-shell:px-bakin-6 @md/page-shell:pt-bakin-6 @xl/page-shell:px-bakin-8 @xl/page-shell:pt-bakin-8',
        mode === 'immersive' &&
          '[&_[data-slot=page-header-context]]:hidden [&_[data-slot=page-header-trailing]]:hidden @md/page-shell:[&_[data-slot=page-header-context]]:flex @md/page-shell:[&_[data-slot=page-header-trailing]]:flex',
        className,
      )}
    />
  )
}

type NativeWorkspacePageCompactHeaderProps = Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'title'
>

export interface WorkspacePageCompactHeaderProps
  extends NativeWorkspacePageCompactHeaderProps {
  /** Client-routed back control or other compact navigation. */
  navigation?: React.ReactNode
  /** Truncated current workspace identity. */
  title: React.ReactNode
  /** One primary action that remains available while the full header is gone. */
  action?: React.ReactNode
  /** Secondary actions rendered in the shared circular overflow menu. */
  overflowActions?: React.ReactNode
  /** Accessible name for the overflow trigger. */
  overflowActionsLabel?: string
}

/**
 * Persistent sticky context for immersive canvases — every viewport.
 *
 * Keep this row intentionally small: navigation, one-line identity, one
 * primary action, and the shared overflow menu. Place it immediately after
 * WorkspacePageHeader so the full identity scrolls away before this row
 * reaches its sticky position.
 */
export function WorkspacePageCompactHeader({
  action,
  className,
  navigation,
  overflowActions,
  overflowActionsLabel = 'More actions',
  title,
  ...props
}: WorkspacePageCompactHeaderProps) {
  const { flow } = React.useContext(WorkspacePageContext)
  // Desktop shows this row only once it is actually stuck (the full header
  // has scrolled away) — pre-scroll it would duplicate the identity and
  // actions. Mobile keeps it always visible: the immersive full header
  // hides its context/trailing rows there, so this row is their only home.
  // The sentinel marks the row's natural flow position; when it leaves the
  // shell's clip box the row is stuck. Appearing/disappearing causes no
  // layout shift — the row's flow slot is already off-screen when shown.
  const [stuck, setStuck] = React.useState(false)
  const sentinelRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    // Root on the workspace shell, not the viewport: the shell clips the
    // sentinel as it scrolls out, and a viewport-rooted observer would sit
    // on the zero-area boundary without flipping.
    const root = sentinel.closest('[data-archetype="workspace"]')
    if (!(root instanceof HTMLElement)) return
    let observer: IntersectionObserver | null = null
    // @md/page-shell — the container width where the pre-stick row hides.
    const MD_CONTAINER_PX = 448
    const arm = () => {
      observer?.disconnect()
      // Viewport-fit (non-flow) desktop reserves NO flow box for the row, so
      // the scroll bottoms out with the sentinel one row-height above the
      // clip edge — flip once it comes within that height of the top (the
      // row then overlays the spent header tail). Flow workspaces and
      // mobile keep a real flow slot, so the sentinel fully exits: a 1px
      // inset makes the knife edge unambiguous on fractional pixels.
      const overlay = !flow && root.clientWidth >= MD_CONTAINER_PX
      observer = new IntersectionObserver(
        ([entry]) => setStuck(!entry.isIntersecting),
        {
          root,
          rootMargin: overlay ? '-56px 0px 0px 0px' : '-1px 0px 0px 0px',
          threshold: 0,
        },
      )
      observer.observe(sentinel)
    }
    arm()
    const resize = new ResizeObserver(() => arm())
    resize.observe(root)
    return () => {
      observer?.disconnect()
      resize.disconnect()
    }
  }, [flow])
  return (
    <>
    <div ref={sentinelRef} aria-hidden="true" className="h-px w-full shrink-0" />
    {/* The anchor is the row's flow slot. Flow and mobile: sticky — the row
        occupies real space when visible and pins at the top. Non-flow
        desktop: a zero-height positioned anchor — the row renders
        absolutely ABOVE it, so it never reserves a dead band between the
        header and the viewport-fit body; scroll bottoms out with the
        anchor one row-height below the clip edge, and the row exactly
        overlays the spent header tail. */}
    <div
      data-slot="workspace-page-compact-anchor"
      className={cn(
        'sticky top-0 z-30 min-w-0 shrink-0',
        !flow && '@md/page-shell:relative @md/page-shell:top-auto',
      )}
    >
    <div
      {...props}
      data-slot="workspace-page-compact-header"
      data-stuck={stuck ? '' : undefined}
      className={cn(
        'flex h-[var(--bakin-workspace-compact-header-height)] min-w-0 items-center gap-bakin-2 bg-bakin-canvas-default px-bakin-4 @md/page-shell:px-bakin-6',
        !flow && '@md/page-shell:absolute @md/page-shell:inset-x-0 @md/page-shell:bottom-full',
        // The separator earns its keep only when stuck (content sliding
        // beneath); pre-stick it would stack a second rule on the section
        // divider below it.
        stuck && 'border-b border-bakin-border-subtle',
        // Pre-stick desktop hides the row entirely — no reserved box, no
        // dead band between header and body. It appears with no layout
        // shift: in flow its slot is already off-screen; in non-flow it
        // overlays out-of-flow.
        !stuck && '@md/page-shell:hidden',
        className,
      )}
    >
      {navigation ? (
        <div
          data-slot="workspace-page-compact-navigation"
          className="min-w-0 shrink-0"
        >
          {navigation}
        </div>
      ) : null}
      <div
        data-slot="workspace-page-compact-title"
        className={cn(
          // Arbitrary-length, not the `text-bakin-typography-size-*` shorthand:
          // the size and the colour are both `text-*`, so tailwind-merge kept
          // only the colour and this title silently rendered at the inherited
          // size. Same hazard the Text primitive documents.
          'min-w-0 flex-1 truncate text-[length:var(--bakin-typography-size-body)] font-bakin-typography-weight-bold text-bakin-text-primary',
          // Pre-stick the full identity is still on screen — repeating the
          // title here reads as a phantom second header. It appears only
          // once it is the surviving identity.
          !stuck && 'invisible',
        )}
      >
        {title}
      </div>
      {action ? (
        <div
          data-slot="workspace-page-compact-action"
          className="min-w-0 shrink-0"
        >
          {action}
        </div>
      ) : null}
      {overflowActions ? (
        <PageHeaderOverflowMenu label={overflowActionsLabel}>
          {overflowActions}
        </PageHeaderOverflowMenu>
      ) : null}
    </div>
    </div>
    </>
  )
}

export type WorkspacePageMetricsProps = React.ComponentPropsWithoutRef<'div'>

/**
 * Metric tiles between the workspace identity and its controls — the stat
 * strip zone. Hidden on phones, where the compact header owns the chrome.
 * Omit the component entirely when a workspace has no metrics: the frame
 * closes up with no reserved band.
 */
export function WorkspacePageMetrics({
  className,
  ...props
}: WorkspacePageMetricsProps) {
  return (
    <div
      {...props}
      data-slot="workspace-page-metrics"
      className={cn(
        'hidden min-w-0 px-bakin-4 pb-bakin-4 pt-bakin-2 @md/page-shell:block @md/page-shell:px-bakin-6',
        className,
      )}
    />
  )
}

export type WorkspacePageBodyProps = React.ComponentPropsWithoutRef<'div'>

/**
 * Flush remaining canvas. The mobile activity trigger lives in the host nav,
 * so this body only preserves the device safe area. In a `flow` workspace
 * the body grows with its content instead of bounding it — while still
 * absorbing the shell's leftover height (the shell content box is a
 * min-h-full column), so short content leaves the body at the fold rather
 * than mid-page.
 */
export function WorkspacePageBody({
  className,
  ...props
}: WorkspacePageBodyProps) {
  const { mode, flow } = React.useContext(WorkspacePageContext)

  return (
    <div
      {...props}
      data-slot="workspace-page-body"
      data-flow={flow ? '' : undefined}
      className={cn(
        'flex min-w-0 pb-[env(safe-area-inset-bottom)] @md/page-shell:pb-0',
        flow
          // flex-1 (not flex-none): the shell content box is a min-h-full
          // column, so growing here is what carries a short flow page to
          // the viewport bottom; tall content still exceeds it freely.
          ? 'flex-1 flex-col'
          : 'min-h-0 flex-1 overflow-hidden',
        !flow && mode === 'immersive' &&
          'h-[calc(100%-var(--bakin-workspace-compact-header-height))] min-h-[calc(100%-var(--bakin-workspace-compact-header-height))] flex-none',
        className,
      )}
    />
  )
}
