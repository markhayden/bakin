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
   * document; the compact row still sticks). Default keeps the
   * viewport-bound canvas whose children own their scrolling.
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
    // Root on the workspace shell, not the viewport: in a viewport-fit
    // (non-flow) workspace the scroll bottoms out EXACTLY when the row
    // reaches its sticky position, so the sentinel stops at the shell's clip
    // edge instead of travelling past it — a viewport-rooted observer sits on
    // that zero-area boundary and never flips. The 1px top inset makes the
    // knife edge unambiguous on fractional-pixel layouts.
    const root = sentinel.closest('[data-archetype="workspace"]')
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      {
        root: root instanceof HTMLElement ? root : null,
        rootMargin: '-1px 0px 0px 0px',
        threshold: 0,
      },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])
  return (
    <>
    <div ref={sentinelRef} aria-hidden="true" className="h-px w-full shrink-0" />
    <div
      {...props}
      data-slot="workspace-page-compact-header"
      data-stuck={stuck ? '' : undefined}
      className={cn(
        'sticky top-0 z-30 flex h-[var(--bakin-workspace-compact-header-height)] min-w-0 shrink-0 items-center gap-bakin-2 bg-bakin-canvas-default px-bakin-4 @md/page-shell:px-bakin-6',
        // The separator earns its keep only when stuck (content sliding
        // beneath); in flow it would stack a second rule on the section
        // divider below it.
        stuck && 'border-b border-bakin-border-subtle',
        // Pre-stick desktop treatment depends on the workspace's scroll
        // model. Viewport-fit canvases (non-flow): `invisible` — the row's
        // flow box must keep contributing its height to the scroll length
        // or the shell can never scroll far enough to stick it. Flow
        // workspaces: `hidden` — scroll length is content-driven, so the
        // reserved box is pure dead band between header and body (the
        // tasks stats gap); the row appears at its sticky position with
        // no layout shift because its flow slot is already off-screen.
        !stuck && (flow ? '@md/page-shell:hidden' : '@md/page-shell:invisible'),
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
          'min-w-0 flex-1 truncate text-bakin-typography-size-body font-bakin-typography-weight-bold text-bakin-text-primary',
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
    </>
  )
}

export type WorkspacePageBodyProps = React.ComponentPropsWithoutRef<'div'>

/**
 * Flush remaining canvas. The mobile activity trigger lives in the host nav,
 * so this body only preserves the device safe area. In a `flow` workspace
 * the body grows with its content instead of bounding it.
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
          ? 'flex-none flex-col'
          : 'min-h-0 flex-1 overflow-hidden',
        !flow && mode === 'immersive' &&
          'h-[calc(100%-var(--bakin-workspace-compact-header-height))] min-h-[calc(100%-var(--bakin-workspace-compact-header-height))] flex-none',
        className,
      )}
    />
  )
}
