'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Shared core for the two split-pane resize hooks. A pane is anchored to the
 * trailing edge (bottom for 'y', right for 'x') and resized by dragging the
 * divider on its leading edge — dragging toward that edge (up / left) grows it.
 * {@link useVerticalResize} and {@link useHorizontalResize} are thin wrappers;
 * keep all drag / persistence / a11y logic here so it lives in exactly one place.
 */
export type ResizeAxis = 'x' | 'y'

interface CoreOptions {
  axis: ResizeAxis
  defaultSize: number
  minSize: number
  maxSize: number
  /** localStorage key suffix; persisted under `${storagePrefix}${storageKey}`. */
  storageKey?: string
  storagePrefix: string
}

export interface ResizeHandleProps {
  role: 'separator'
  tabIndex: 0
  'aria-orientation': 'horizontal' | 'vertical'
  'aria-valuenow': number
  'aria-valuemin': number
  'aria-valuemax': number
  onMouseDown: (e: React.MouseEvent) => void
  onTouchStart: (e: React.TouchEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

export interface ResizablePane {
  size: number
  setSize: (n: number) => void
  handleProps: ResizeHandleProps
}

const KEY_STEP = 16
const KEY_STEP_LARGE = 64

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function readStored(def: number, min: number, max: number, prefix: string, storageKey?: string): number {
  if (!storageKey || typeof window === 'undefined') return clamp(def, min, max)
  try {
    const raw = window.localStorage.getItem(prefix + storageKey)
    if (!raw) return clamp(def, min, max)
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) ? clamp(parsed, min, max) : clamp(def, min, max)
  } catch (err) {
    console.error('useResizablePane: failed to read stored size', err)
    return clamp(def, min, max)
  }
}

export function useResizablePane({ axis, defaultSize, minSize, maxSize, storageKey, storagePrefix }: CoreOptions): ResizablePane {
  const [size, setSizeState] = useState(() => readStored(defaultSize, minSize, maxSize, storagePrefix, storageKey))
  // sizeRef mirrors the latest size and is kept current at every mutation site
  // (setSize, onMove, the re-clamp effect), so drag handlers read it without a
  // dependency on the render cycle and without a separate ref-sync effect.
  const sizeRef = useRef(size)
  const dragging = useRef(false)
  const dragStart = useRef(0)
  const dragStartSize = useRef(0)

  const persist = useCallback((n: number) => {
    if (!storageKey || typeof window === 'undefined') return
    try {
      window.localStorage.setItem(storagePrefix + storageKey, String(clamp(n, minSize, maxSize)))
    } catch (err) {
      console.error('useResizablePane: failed to persist size', err)
    }
  }, [storageKey, storagePrefix, minSize, maxSize])

  const setSize = useCallback((n: number) => {
    const next = clamp(n, minSize, maxSize)
    sizeRef.current = next
    setSizeState(next)
    persist(next)
  }, [minSize, maxSize, persist])

  // Re-clamp the live size if the bounds tighten between renders (e.g. a
  // consumer drives min/max responsively). Only fires when bounds change.
  useEffect(() => {
    const clamped = clamp(sizeRef.current, minSize, maxSize)
    if (clamped !== sizeRef.current) setSize(clamped)
  }, [minSize, maxSize, setSize])

  const beginDrag = useCallback((client: number) => {
    dragging.current = true
    dragStart.current = client
    dragStartSize.current = sizeRef.current
  }, [])

  const onMove = useCallback((client: number) => {
    if (!dragging.current) return
    // Dragging toward the leading edge (up / left) grows the pane.
    const delta = dragStart.current - client
    const next = clamp(dragStartSize.current + delta, minSize, maxSize)
    sizeRef.current = next
    setSizeState(next)
  }, [minSize, maxSize])

  const endDrag = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    persist(sizeRef.current)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [persist])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    beginDrag(axis === 'x' ? e.clientX : e.clientY)
    const move = (ev: MouseEvent) => onMove(axis === 'x' ? ev.clientX : ev.clientY)
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      endDrag()
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }, [axis, beginDrag, onMove, endDrag])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    if (!touch) return
    beginDrag(axis === 'x' ? touch.clientX : touch.clientY)
    const move = (ev: TouchEvent) => {
      const t = ev.touches[0]
      if (!t) return
      // Suppress the page scroll/rubber-band so the drag actually resizes.
      // Requires the listener below to be registered with { passive: false }.
      ev.preventDefault()
      onMove(axis === 'x' ? t.clientX : t.clientY)
    }
    const up = () => {
      document.removeEventListener('touchmove', move)
      document.removeEventListener('touchend', up)
      document.removeEventListener('touchcancel', up)
      endDrag()
    }
    document.addEventListener('touchmove', move, { passive: false })
    document.addEventListener('touchend', up)
    document.addEventListener('touchcancel', up)
  }, [axis, beginDrag, onMove, endDrag])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const growKey = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
    const shrinkKey = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
    let dir = 0
    if (e.key === growKey) dir = 1
    else if (e.key === shrinkKey) dir = -1
    else return
    e.preventDefault()
    const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    setSize(sizeRef.current + dir * step)
  }, [axis, setSize])

  return {
    size,
    setSize,
    handleProps: {
      role: 'separator',
      tabIndex: 0,
      'aria-orientation': axis === 'x' ? 'vertical' : 'horizontal',
      'aria-valuenow': size,
      'aria-valuemin': minSize,
      'aria-valuemax': maxSize,
      onMouseDown,
      onTouchStart,
      onKeyDown,
    },
  }
}
