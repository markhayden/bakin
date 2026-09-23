'use client'

import { useState, useCallback, useEffect, type CSSProperties, type ReactNode } from 'react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { ResizeHandle, usePersistedLeadingEdgeResize } from '../../packages/host/src/ui/resize'
// The dialog shim rather than `@makinbakin/sdk`: the SDK ui entrypoint
// re-exports this Drawer, so importing the SDK here would be a module cycle.
import { UnsavedChangesDialog } from '@/components/ui/dialog'

/** Drawers cannot save in place, so the exit dialog never renders its save action. */
function noopSave(): void {
  // Intentionally empty — `canSaveInPlace={false}` hides the button.
}

const MIN_WIDTH = 320
const MAX_WIDTH = 960
const DEFAULT_WIDTH = 810
const DRAWER_WIDTH_STORAGE_KEY = 'bakin-drawer-width'

function getDrawerWidthStorageKey(storageKey?: string) {
  return storageKey ? `${DRAWER_WIDTH_STORAGE_KEY}:${storageKey}` : DRAWER_WIDTH_STORAGE_KEY
}

export interface DrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: ReactNode
  /** Accessible title used when the visible title is intentionally omitted. */
  ariaLabel?: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  defaultWidth?: number
  /** Optional suffix for per-context drawer width persistence. */
  storageKey?: string
  /** When provided, a back action appears left of the title. */
  onBack?: () => void
  /** When true, closing the drawer shows an unsaved-changes confirmation. */
  dirty?: boolean
  /** Prevents escape, outside, close-button, and dirty-confirm dismissal while work is in flight. */
  busy?: boolean
}

export function Drawer({
  open,
  onOpenChange,
  title,
  ariaLabel = 'Details',
  description,
  actions,
  children,
  defaultWidth = DEFAULT_WIDTH,
  storageKey,
  onBack,
  dirty = false,
  busy = false,
}: DrawerProps) {
  const { size: width, handleProps } = usePersistedLeadingEdgeResize({
    axis: 'x',
    defaultSize: defaultWidth,
    minSize: MIN_WIDTH,
    maxSize: MAX_WIDTH,
    storageKey: getDrawerWidthStorageKey(storageKey),
    disabled: !open,
  })
  const [showDirtyConfirm, setShowDirtyConfirm] = useState(false)

  useEffect(() => {
    if (!open) setShowDirtyConfirm(false)
  }, [open])

  const requestClose = useCallback(() => {
    if (busy) return
    if (dirty) {
      setShowDirtyConfirm(true)
    } else {
      onOpenChange(false)
    }
  }, [busy, dirty, onOpenChange])

  const confirmDiscard = useCallback(() => {
    setShowDirtyConfirm(false)
    onOpenChange(false)
  }, [onOpenChange])

  return (
    <>
      <Sheet
        open={open}
        busy={busy}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            requestClose()
          } else {
            onOpenChange(true)
          }
        }}
      >
        <SheetContent
          side="right"
          className="overflow-y-auto p-0 data-[side=right]:sm:w-[var(--bakin-drawer-width)] data-[side=right]:sm:max-w-[min(var(--bakin-drawer-width),calc(100vw-var(--bakin-layout-space-4)))]"
          showCloseButton={false}
          style={{ '--bakin-drawer-width': `${width}px` } as CSSProperties}
        >
          <ResizeHandle
            orientation="vertical"
            handleProps={handleProps}
            label="Resize panel"
            visibleAtRest
            className="absolute inset-y-0 left-0 z-10 hidden w-bakin-2 cursor-col-resize sm:flex"
          />

          <div
            data-slot="drawer-layout"
            className="flex min-h-full shrink-0 flex-col gap-bakin-6 px-bakin-4 pb-bakin-8 pt-bakin-4 sm:px-bakin-6"
          >
            <SheetHeader inset="none">
              <div className="flex min-w-0 items-center justify-between gap-bakin-2">
                <div className="flex min-w-0 items-center gap-bakin-2">
                  {onBack ? (
                    <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back" disabled={busy}>
                      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4 fill-none stroke-current stroke-[1.75]">
                        <path d="m10.5 3-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </Button>
                  ) : null}
                  <SheetTitle className={title ? 'truncate' : 'sr-only'}>{title ?? ariaLabel}</SheetTitle>
                </div>
                <div className="flex shrink-0 items-center gap-bakin-1">
                  {actions}
                  <Button variant="ghost" size="icon-sm" onClick={requestClose} aria-label="Close panel" disabled={busy}>
                    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4 fill-none stroke-current stroke-[1.75]">
                      <path d="m4 4 8 8M12 4l-8 8" strokeLinecap="round" />
                    </svg>
                  </Button>
                </div>
              </div>
              {description ? <SheetDescription>{description}</SheetDescription> : null}
            </SheetHeader>
            <div data-slot="drawer-content" className="min-w-0">{children}</div>
          </div>
        </SheetContent>
      </Sheet>

      <UnsavedChangesDialog
        open={showDirtyConfirm}
        busy={busy}
        canSaveInPlace={false}
        description="You have unsaved changes that will be lost if you close this drawer."
        cancelLabel="Keep editing"
        discardLabel="Discard changes"
        onSave={noopSave}
        onDiscard={confirmDiscard}
        onCancel={() => setShowDirtyConfirm(false)}
      />
    </>
  )
}

export {
  MIN_WIDTH,
  MAX_WIDTH,
  DEFAULT_WIDTH,
  DRAWER_WIDTH_STORAGE_KEY,
  getDrawerWidthStorageKey,
}
