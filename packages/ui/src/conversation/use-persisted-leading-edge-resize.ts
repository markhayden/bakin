'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'

const RESIZE_STEP = 16
const RESIZE_STEP_LARGE = 64

type ResizeAxis = 'x' | 'y'

interface PersistedResizeOptions {
  axis: ResizeAxis
  defaultSize: number
  minSize: number
  maxSize: number
  storageKey?: string
  disabled?: boolean
}

export interface PersistedResizeHandleProps {
  role: 'separator'
  tabIndex: number
  'aria-orientation': 'horizontal' | 'vertical'
  'aria-valuemin': number
  'aria-valuemax': number
  'aria-valuenow': number
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function readSize(storageKey: string | undefined, fallback: number, min: number, max: number) {
  if (!storageKey || typeof window === 'undefined') return clamp(fallback, min, max)
  try {
    const raw = window.localStorage.getItem(storageKey)
    const parsed = raw ? Number.parseInt(raw, 10) : fallback
    return clamp(Number.isFinite(parsed) ? parsed : fallback, min, max)
  } catch {
    return clamp(fallback, min, max)
  }
}

function persistSize(storageKey: string | undefined, value: number) {
  if (!storageKey || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, String(value))
  } catch {
    // Preference storage must never block resizing or keyboard operation.
  }
}

/** Private shared mechanics for a pane resized from its leading edge. */
export function usePersistedLeadingEdgeResize({
  axis,
  defaultSize,
  minSize,
  maxSize,
  storageKey,
  disabled = false,
}: PersistedResizeOptions): { size: number; handleProps: PersistedResizeHandleProps } {
  const [size, setSizeState] = useState(() => readSize(storageKey, defaultSize, minSize, maxSize))
  const sizeRef = useRef(size)
  const pointerRef = useRef<number | null>(null)
  const startRef = useRef({ position: 0, size })
  const bodyStyleRef = useRef({ cursor: '', userSelect: '' })

  const setSize = useCallback((next: number, persist = true) => {
    const resolved = clamp(next, minSize, maxSize)
    sizeRef.current = resolved
    setSizeState(resolved)
    if (persist) persistSize(storageKey, resolved)
  }, [maxSize, minSize, storageKey])

  useEffect(() => {
    const next = readSize(storageKey, defaultSize, minSize, maxSize)
    sizeRef.current = next
    setSizeState(next)
  }, [defaultSize, maxSize, minSize, storageKey])

  useEffect(() => () => {
    if (pointerRef.current === null) return
    document.body.style.cursor = bodyStyleRef.current.cursor
    document.body.style.userSelect = bodyStyleRef.current.userSelect
  }, [])

  const position = (event: PointerEvent<HTMLDivElement>) => axis === 'x' ? event.clientX : event.clientY

  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointerRef.current = event.pointerId
    startRef.current = { position: position(event), size: sizeRef.current }
    bodyStyleRef.current = {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    }
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerRef.current !== event.pointerId) return
    const delta = startRef.current.position - position(event)
    setSize(startRef.current.size + delta, false)
  }

  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerRef.current !== event.pointerId) return
    pointerRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    persistSize(storageKey, sizeRef.current)
    document.body.style.cursor = bodyStyleRef.current.cursor
    document.body.style.userSelect = bodyStyleRef.current.userSelect
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const growKey = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
    const shrinkKey = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
    let next: number | undefined
    if (event.key === growKey) next = sizeRef.current + (event.shiftKey ? RESIZE_STEP_LARGE : RESIZE_STEP)
    if (event.key === shrinkKey) next = sizeRef.current - (event.shiftKey ? RESIZE_STEP_LARGE : RESIZE_STEP)
    if (event.key === 'Home') next = minSize
    if (event.key === 'End') next = maxSize
    if (next === undefined || disabled) return
    event.preventDefault()
    setSize(next)
  }

  return {
    size,
    handleProps: {
      role: 'separator',
      tabIndex: disabled ? -1 : 0,
      'aria-orientation': axis === 'x' ? 'vertical' : 'horizontal',
      'aria-valuemin': minSize,
      'aria-valuemax': maxSize,
      'aria-valuenow': size,
      onPointerDown: begin,
      onPointerMove: move,
      onPointerUp: end,
      onPointerCancel: end,
      onKeyDown: handleKeyDown,
    },
  }
}
