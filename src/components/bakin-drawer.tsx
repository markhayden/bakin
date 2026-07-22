'use client'

import { useRef, useState, useCallback, useEffect, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const MIN_WIDTH = 320
const MAX_WIDTH = 960
const DEFAULT_WIDTH = 810
const DRAWER_WIDTH_STORAGE_KEY = 'bakin-drawer-width'

function clampDrawerWidth(width: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width))
}

function getDrawerWidthStorageKey(storageKey?: string) {
  return storageKey ? `${DRAWER_WIDTH_STORAGE_KEY}:${storageKey}` : DRAWER_WIDTH_STORAGE_KEY
}

function getStoredDrawerWidth(defaultWidth: number, storageKey?: string) {
  const fallbackWidth = clampDrawerWidth(defaultWidth)

  if (typeof window === 'undefined') {
    return fallbackWidth
  }

  try {
    const storedWidth = window.localStorage.getItem(getDrawerWidthStorageKey(storageKey))
    if (!storedWidth) {
      return fallbackWidth
    }

    const parsedWidth = Number.parseInt(storedWidth, 10)
    return Number.isFinite(parsedWidth) ? clampDrawerWidth(parsedWidth) : fallbackWidth
  } catch {
    return fallbackWidth
  }
}

export interface BakinDrawerProps {
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

export function BakinDrawer({
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
}: BakinDrawerProps) {
  const [width, setWidth] = useState(() => getStoredDrawerWidth(defaultWidth, storageKey))
  const [showDirtyConfirm, setShowDirtyConfirm] = useState(false)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)
  const widthRef = useRef(width)

  useEffect(() => {
    setWidth(getStoredDrawerWidth(defaultWidth, storageKey))
  }, [defaultWidth, storageKey])

  useEffect(() => {
    widthRef.current = width
  }, [width])

  useEffect(() => {
    if (!open) setShowDirtyConfirm(false)
  }, [open])

  const persistWidth = useCallback((nextWidth: number) => {
    if (typeof window === 'undefined') return

    try {
      window.localStorage.setItem(getDrawerWidthStorageKey(storageKey), String(clampDrawerWidth(nextWidth)))
    } catch {
      // Ignore storage failures; the drawer should still resize normally.
    }
  }, [storageKey])

  const setAndPersistWidth = useCallback((nextWidth: number) => {
    const clampedWidth = clampDrawerWidth(nextWidth)
    widthRef.current = clampedWidth
    setWidth(clampedWidth)
    persistWidth(clampedWidth)
  }, [persistWidth])

  const handleMouseDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startWidth.current = widthRef.current

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const delta = startX.current - ev.clientX
      const newWidth = clampDrawerWidth(startWidth.current + delta)
      widthRef.current = newWidth
      setWidth(newWidth)
    }

    const handleMouseUp = () => {
      dragging.current = false
      persistWidth(widthRef.current)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [persistWidth])

  const handleResizeKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16
    let nextWidth: number | undefined

    if (event.key === 'ArrowLeft') nextWidth = widthRef.current + step
    if (event.key === 'ArrowRight') nextWidth = widthRef.current - step
    if (event.key === 'Home') nextWidth = MIN_WIDTH
    if (event.key === 'End') nextWidth = MAX_WIDTH

    if (nextWidth !== undefined) {
      event.preventDefault()
      setAndPersistWidth(nextWidth)
    }
  }, [setAndPersistWidth])

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
          <div
            aria-label="Resize panel"
            aria-orientation="vertical"
            aria-valuemax={MAX_WIDTH}
            aria-valuemin={MIN_WIDTH}
            aria-valuenow={width}
            className="absolute inset-y-0 left-0 z-10 hidden w-bakin-2 cursor-col-resize outline-none transition-colors hover:bg-bakin-signal-accent/20 focus-visible:bg-bakin-signal-accent/25 motion-reduce:transition-none sm:block"
            onMouseDown={handleMouseDown}
            onKeyDown={handleResizeKeyDown}
            role="separator"
            tabIndex={0}
          />

          <div
            data-slot="bakin-drawer-layout"
            className="flex min-h-full shrink-0 flex-col gap-bakin-4 px-bakin-4 pb-bakin-8 pt-bakin-4 sm:px-bakin-6"
          >
            <SheetHeader className="p-0 pr-0">
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
            <div data-slot="bakin-drawer-content" className="min-w-0">{children}</div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={showDirtyConfirm} busy={busy} onOpenChange={setShowDirtyConfirm}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>
              You have unsaved changes that will be lost if you close this drawer.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowDirtyConfirm(false)} disabled={busy}>
              Keep editing
            </Button>
            <Button variant="danger" onClick={confirmDiscard} disabled={busy}>
              Discard changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export {
  MIN_WIDTH,
  MAX_WIDTH,
  DEFAULT_WIDTH,
  DRAWER_WIDTH_STORAGE_KEY,
  clampDrawerWidth,
  getDrawerWidthStorageKey,
  getStoredDrawerWidth,
}
