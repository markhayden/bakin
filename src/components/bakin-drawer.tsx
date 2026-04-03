'use client'

import { useRef, useState, useCallback } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ArrowLeft, X } from 'lucide-react'

const MIN_WIDTH = 320
const MAX_WIDTH = 960
const DEFAULT_WIDTH = 810

export function BakinDrawer({
  open,
  onOpenChange,
  title,
  description,
  actions,
  children,
  defaultWidth = DEFAULT_WIDTH,
  onBack,
  dirty = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  defaultWidth?: number
  /** When provided, a back arrow appears left of the title */
  onBack?: () => void
  /** When true, closing the drawer shows an "unsaved changes" confirmation */
  dirty?: boolean
}) {
  const [width, setWidth] = useState(defaultWidth)
  const [showDirtyConfirm, setShowDirtyConfirm] = useState(false)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startWidth.current = width

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const delta = startX.current - ev.clientX
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta))
      setWidth(newWidth)
    }

    const handleMouseUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [width])

  const requestClose = useCallback(() => {
    if (dirty) {
      setShowDirtyConfirm(true)
    } else {
      onOpenChange(false)
    }
  }, [dirty, onOpenChange])

  const confirmDiscard = useCallback(() => {
    setShowDirtyConfirm(false)
    onOpenChange(false)
  }, [onOpenChange])

  return (
    <>
      <Sheet
        open={open}
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
          className="overflow-y-auto p-0"
          showCloseButton={false}
          style={{ width: `${width}px`, maxWidth: `min(${MAX_WIDTH}px, 100vw)` }}
        >
          {/* Drag handle — left edge */}
          <div
            className="absolute inset-y-0 left-0 w-1.5 cursor-col-resize hover:bg-accent/50 active:bg-accent transition-colors z-10"
            onMouseDown={handleMouseDown}
          />

          <div className="px-7 py-6 flex flex-col gap-4 h-full">
            {(title || description || actions) && (
              <SheetHeader className="p-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {onBack && (
                      <button
                        onClick={onBack}
                        className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground shrink-0"
                      >
                        <ArrowLeft className="size-4" />
                        <span className="sr-only">Back</span>
                      </button>
                    )}
                    {title && <SheetTitle className="truncate">{title}</SheetTitle>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {actions}
                    <button
                      onClick={requestClose}
                      className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-4" />
                      <span className="sr-only">Close</span>
                    </button>
                  </div>
                </div>
                {description && <SheetDescription>{description}</SheetDescription>}
              </SheetHeader>
            )}
            <div className="flex-1 min-h-0">{children}</div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Unsaved changes confirmation */}
      <Dialog open={showDirtyConfirm} onOpenChange={setShowDirtyConfirm}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>
              You have unsaved changes that will be lost if you close this drawer.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowDirtyConfirm(false)}>
              Keep editing
            </Button>
            <Button variant="destructive" onClick={confirmDiscard}>
              Discard changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export { MIN_WIDTH, MAX_WIDTH, DEFAULT_WIDTH }
