'use client'

import { useRouter as useTanStackRouter, type HistoryLocation } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { UnsavedChangesDialog, type UnsavedChangesDialogProps } from '@bakin/ui/patterns'

type RouteNavigationBlocker =
  | { status: 'idle' }
  | { status: 'blocked'; proceed: () => void; reset: () => void }

export interface UnsavedChangesGuardOptions {
  /** True while the surface holds unsaved edits. */
  hasUnsavedChanges: boolean
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
      blockerFn: async ({
        currentLocation,
        nextLocation,
      }: {
        currentLocation: HistoryLocation
        nextLocation: HistoryLocation
      }) => {
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
    if (routeBlocker.status === 'blocked') routeBlocker.reset()
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
