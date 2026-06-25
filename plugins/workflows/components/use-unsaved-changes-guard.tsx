'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter as useTanStackRouter } from '@tanstack/react-router'
import { Button } from "@makinbakin/sdk/ui"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@makinbakin/sdk/ui"

type RouteNavigationBlocker =
  | { status: 'idle' }
  | { status: 'blocked'; proceed: () => void; reset: () => void }

interface UnsavedChangesGuardOptions {
  /** True while the surface holds unsaved edits — gates all the interception. */
  hasUnsavedChanges: boolean
  /** True while a save is in flight — disables the dialog actions. */
  saving: boolean
  /** Whether the "Save and exit" action is offered (e.g. managed sources can't save in place). */
  canSaveInPlace: boolean
  /** Extra disable for "Save and exit" beyond `saving` (e.g. an open node drawer). */
  saveDisabled: boolean
  /** Final navigation when there is nothing to confirm / after the user proceeds. */
  onCancel?: () => void
  /** Persist + clear dirty state. Resolves true to proceed with the exit, false to stay. */
  onSaveAndExit: () => Promise<boolean>
  /** Drop dirty state without saving. */
  onDiscardAndExit: () => void
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
  canSaveInPlace,
  saveDisabled,
  onCancel,
  onSaveAndExit,
  onDiscardAndExit,
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
      blockerFn: async ({ currentLocation, nextLocation }) => {
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
    <Dialog
      open={confirmingExit || routeBlocker.status === 'blocked'}
      onOpenChange={(open) => {
        if (!open && !saving) cancelExitPrompt()
      }}
    >
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Unsaved workflow changes</DialogTitle>
          <DialogDescription>
            You have unsaved changes on this workflow. Save them before leaving, discard them, or stay on the canvas.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="destructive"
            onClick={handleDiscardAndExit}
            disabled={saving}
          >
            Discard changes
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={cancelExitPrompt}
              disabled={saving}
            >
              Cancel
            </Button>
            {canSaveInPlace && (
              <Button
                onClick={handleSaveAndExit}
                disabled={saving || saveDisabled}
              >
                {saving ? 'Saving...' : 'Save and exit'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { requestExit, reset, dialog }
}
