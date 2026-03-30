'use client'

import { useRef, useState, useCallback } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'

const MIN_WIDTH = 400
const MAX_WIDTH = 960
const DEFAULT_WIDTH = 560

export function BakinDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  defaultWidth = DEFAULT_WIDTH,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  defaultWidth?: number
}) {
  const [width, setWidth] = useState(defaultWidth)
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="overflow-y-auto p-0"
        style={{ width: `${width}px`, maxWidth: `${MAX_WIDTH}px` }}
      >
        {/* Drag handle — left edge */}
        <div
          className="absolute inset-y-0 left-0 w-1.5 cursor-col-resize hover:bg-accent/50 active:bg-accent transition-colors z-10"
          onMouseDown={handleMouseDown}
        />

        <div className="p-6 flex flex-col gap-4 h-full">
          {(title || description) && (
            <SheetHeader className="p-0">
              {title && <SheetTitle>{title}</SheetTitle>}
              {description && <SheetDescription>{description}</SheetDescription>}
            </SheetHeader>
          )}
          <div className="flex-1 min-h-0">{children}</div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export { MIN_WIDTH, MAX_WIDTH, DEFAULT_WIDTH }
