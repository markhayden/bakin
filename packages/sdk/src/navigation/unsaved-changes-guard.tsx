'use client'

import { useRouter as useTanStackRouter, type HistoryLocation } from '@tanstack/react-router'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { UnsavedChangesDialog, type UnsavedChangesDialogProps } from '@bakin/ui/patterns/unsaved-changes-dialog'

type RouteNavigationBlocker =
  | { status: 'idle' }
  | { status: 'blocked'; proceed: () => void; reset: () => void }

/** The parts of a parsed location a same-location decision may read. */
export interface UnsavedChangesGuardLocation {
  pathname: string
  search: Record<string, unknown>
  searchStr: string
}

export interface UnsavedChangesGuardOptions {
  /** True while the surface holds unsaved edits. */
  hasUnsavedChanges: boolean
  /**
   * When is a navigation "staying here"? Default: the same pathname (query
   * and hash changes never prompt). A surface whose identity lives in query
   * params (a recover editor keyed by `?recover=1&skill=…`) passes its own
   * comparison so Back or a query change that unmounts it asks first.
   */
  isSameLocation?: (current: UnsavedChangesGuardLocation, next: UnsavedChangesGuardLocation) => boolean
  /** True while a save is in flight. */
  saving: boolean
  /** Whether the save-and-exit choice is available. */
  canSaveInPlace?: boolean
  /** Additional save-and-exit disable state. */
  saveDisabled?: boolean
  /** Final controlled exit when nothing needs confirmation. */
  onCancel?: () => void
  /** Persist and clear dirty state; true proceeds with the exit. */
  onSaveAndExit: () => Promise<boolean>
  /** Drop dirty state without saving. */
  onDiscardAndExit: () => void
  title?: ReactNode
  description?: ReactNode
  /** Retryable save error retained inside the decision. */
  error?: ReactNode
  saveLabel?: string
  /** Focus destination after an explicit controlled prompt closes. */
  finalFocus?: UnsavedChangesDialogProps['finalFocus']
}

export interface UnsavedChangesGuardResult {
  requestExit: () => void
  reset: () => void
  dialog: ReactNode
}

/**
 * Complete dirty-exit behavior for browser unload, TanStack navigation,
 * intercepted same-origin anchors, and explicit cancel/back actions.
 */
export function useUnsavedChangesGuard({
  hasUnsavedChanges,
  isSameLocation,
  saving,
  canSaveInPlace = true,
  saveDisabled = false,
  onCancel,
  onSaveAndExit,
  onDiscardAndExit,
  title = 'Unsaved changes',
  description = 'You have unsaved changes. Save them before leaving, discard them, or stay here.',
  error,
  saveLabel = 'Save and exit',
  finalFocus,
}: UnsavedChangesGuardOptions): UnsavedChangesGuardResult {
  // `routeBlocker` (state) drives the decision dialog; `activeBlocker` (ref,
  // written synchronously when a navigation blocks) is the AUTHORITY every
  // settle path uses. A save that finishes before React renders the blocker
  // — or a continuation holding an older render's closure — still settles
  // the navigation that is actually pending, never a stale/idle copy.
  const [routeBlocker, setRouteBlocker] = useState<RouteNavigationBlocker>({ status: 'idle' })
  const activeBlocker = useRef<Extract<RouteNavigationBlocker, { status: 'blocked' }> | null>(null)
  const [confirmingExit, setConfirmingExit] = useState(false)
  const [pendingNavigationHref, setPendingNavigationHref] = useState<string | null>(null)
  const tanStackRouter = useTanStackRouter()

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const unblock = tanStackRouter.history.block({
      enableBeforeUnload: false,
      blockerFn: async ({
        currentLocation,
        nextLocation,
      }: {
        currentLocation: HistoryLocation
        nextLocation: HistoryLocation
      }) => {
        const current = tanStackRouter.parseLocation(currentLocation)
        const next = tanStackRouter.parseLocation(nextLocation)
        const staying = isSameLocation
          ? isSameLocation(current as UnsavedChangesGuardLocation, next as UnsavedChangesGuardLocation)
          : current.pathname === next.pathname
        if (staying) return false

        // A newer navigation supersedes a pending one: the older stays blocked
        // (settled now, never orphaned) and the decision is about the newer.
        settleBlocker('reset')
        let blocker!: Extract<RouteNavigationBlocker, { status: 'blocked' }>
        const shouldBlock = await new Promise<boolean>((resolve) => {
          blocker = {
            status: 'blocked',
            proceed: () => resolve(false),
            reset: () => resolve(true),
          }
          activeBlocker.current = blocker
          setRouteBlocker(blocker)
        })
        // Only clear the dialog state this blocker owns — a newer blocker's
        // prompt must stay open.
        setRouteBlocker((state) => (state === blocker ? { status: 'idle' } : state))
        return shouldBlock
      },
    })
    // Teardown only unsubscribes: it also runs when the router identity
    // changes or StrictMode replays effects while edits are still unsaved,
    // and a pending navigation must not slip through then. TanStack's
    // unsubscribe never resolves an in-flight blocker call; the ref still
    // holds it, so the decision dialog can still settle it.
    return unblock
  }, [hasUnsavedChanges, isSameLocation, tanStackRouter])

  // Clean again (saved or discarded): nothing is left to lose, so a
  // navigation still waiting on the decision goes through. The blocker's
  // own continuation returns the state to idle once it resolves; the
  // dialog below never shows a blocked state while nothing is unsaved.
  useEffect(() => {
    if (!hasUnsavedChanges) settleBlocker('proceed')
  }, [hasUnsavedChanges])

  // Unmounting with a navigation still waiting: let it go through rather than
  // leave its promise pending forever. StrictMode replays this cleanup and the
  // effect back-to-back on a live component, so the settle waits a microtask
  // and runs only if nothing re-mounted.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      queueMicrotask(() => { if (!mounted.current) settleBlocker('proceed') })
    }
  }, [])

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const handleDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target as Element | null
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.hasAttribute('download')) return
      if (anchor.origin !== window.location.origin) return
      if (anchor.href === window.location.href) return

      event.preventDefault()
      event.stopPropagation()
      setPendingNavigationHref(anchor.href)
      setConfirmingExit(true)
    }

    document.addEventListener('click', handleDocumentClick, true)
    return () => document.removeEventListener('click', handleDocumentClick, true)
  }, [hasUnsavedChanges])

  /** Settle the pending navigation (if any) exactly once: proceed or stay. */
  function settleBlocker(outcome: 'proceed' | 'reset'): boolean {
    const blocker = activeBlocker.current
    if (!blocker) return false
    activeBlocker.current = null
    blocker[outcome]()
    return true
  }

  function completeExit() {
    if (settleBlocker('proceed')) return
    const href = pendingNavigationHref
    setPendingNavigationHref(null)
    if (href) {
      window.location.assign(href)
      return
    }
    onCancel?.()
  }

  function cancelExitPrompt() {
    settleBlocker('reset')
    setPendingNavigationHref(null)
    setConfirmingExit(false)
  }

  function requestExit() {
    if (!onCancel) return
    if (hasUnsavedChanges) {
      setPendingNavigationHref(null)
      setConfirmingExit(true)
      return
    }
    onCancel()
  }

  function reset() {
    settleBlocker('reset')
    setRouteBlocker({ status: 'idle' })
    setConfirmingExit(false)
    setPendingNavigationHref(null)
  }

  async function handleSaveAndExit() {
    if (await onSaveAndExit()) {
      setConfirmingExit(false)
      completeExit()
    }
  }

  function handleDiscardAndExit() {
    onDiscardAndExit()
    setConfirmingExit(false)
    completeExit()
  }

  const dialog = (
    <UnsavedChangesDialog
      open={confirmingExit || (routeBlocker.status === 'blocked' && hasUnsavedChanges)}
      busy={saving}
      canSaveInPlace={canSaveInPlace}
      saveDisabled={saveDisabled}
      title={title}
      description={description}
      error={error}
      saveLabel={saveLabel}
      finalFocus={finalFocus}
      onSave={() => { void handleSaveAndExit() }}
      onDiscard={handleDiscardAndExit}
      onCancel={cancelExitPrompt}
    />
  )

  return { requestExit, reset, dialog }
}
