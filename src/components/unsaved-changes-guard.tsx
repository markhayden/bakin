'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter as useTanStackRouter, type HistoryLocation } from '@tanstack/react-router'
import { UnsavedChangesDialog, type UnsavedChangesDialogProps } from '@bakin/ui/patterns'

type RouteNavigationBlocker =
  | { status: 'idle' }
  | { status: 'blocked'; proceed: () => void; reset: () => void }

export interface UnsavedChangesGuardOptions {
  /** True while the surface holds unsaved edits — gates all the interception. */
  hasUnsavedChanges: boolean
  /** True while a save is in flight — disables the dialog actions. */
  saving: boolean
  /** Whether the "Save and exit" action is offered (default true; e.g. managed sources can't save in place). */
  canSaveInPlace?: boolean
  /** Extra disable for "Save and exit" beyond `saving` (e.g. an open node drawer). */
  saveDisabled?: boolean
  /** Final navigation when there is nothing to confirm / after the user proceeds. */
  onCancel?: () => void
  /** Persist + clear dirty state. Resolves true to proceed with the exit, false to stay. */
  onSaveAndExit: () => Promise<boolean>
  /** Drop dirty state without saving. */
  onDiscardAndExit: () => void
  /** Dialog copy overrides — defaults are surface-neutral. */
  title?: ReactNode
  description?: ReactNode
  /** Retryable save error retained inside the exit decision. */
  error?: ReactNode
  saveLabel?: string
  /** Focus destination after an explicit controlled exit prompt closes. */
  finalFocus?: UnsavedChangesDialogProps['finalFocus']
}

/**
 * Generic unsaved-changes navigation guard: beforeunload, the TanStack
 * history blocker, and a capture-phase anchor-click interceptor (TanStack's
 * blocker misses plain `<a href>` navigation). Surfaces an exit-confirmation
 * dialog and a `requestExit()` to drive from an explicit cancel/back button.
 * `reset()` clears the in-flight prompt state — call it when the host re-seeds
 * (its props-change reset effect) so a stale prompt can't linger.
 */
export function useUnsavedChangesGuard({
  hasUnsavedChanges,
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
}: UnsavedChangesGuardOptions): { requestExit: () => void; reset: () => void; dialog: ReactNode } {
  const [routeBlocker, setRouteBlocker] = useState<RouteNavigationBlocker>({ status: 'idle' })
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
    return tanStackRouter.history.block({
      enableBeforeUnload: false,
      // Explicit types: the published-SDK declaration emit runs with
      // noImplicitAny and cannot infer these the way the app tsconfig does.
      blockerFn: async ({ currentLocation, nextLocation }: { currentLocation: HistoryLocation; nextLocation: HistoryLocation }) => {
        const current = tanStackRouter.parseLocation(currentLocation)
        const next = tanStackRouter.parseLocation(nextLocation)
        if (current.pathname === next.pathname) return false

        const shouldBlock = await new Promise<boolean>((resolve) => {
          setRouteBlocker({
            status: 'blocked',
            proceed: () => resolve(false),
            reset: () => resolve(true),
          })
        })
        setRouteBlocker({ status: 'idle' })
        return shouldBlock
      },
    })
  }, [hasUnsavedChanges, tanStackRouter])

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

  function completeExit() {
    if (routeBlocker.status === 'blocked') {
      routeBlocker.proceed()
      return
    }
    const href = pendingNavigationHref
    setPendingNavigationHref(null)
    if (href) {
      window.location.assign(href)
      return
    }
    onCancel?.()
  }

  function cancelExitPrompt() {
    if (routeBlocker.status === 'blocked') {
      routeBlocker.reset()
    }
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
    if (routeBlocker.status === 'blocked') routeBlocker.reset()
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
      open={confirmingExit || routeBlocker.status === 'blocked'}
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
