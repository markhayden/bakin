'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface Options {
  defaultHeight: number
  minHeight: number
  maxHeight: number
  /** When set, height is persisted in localStorage under `bakin-vresize:${storageKey}`. */
  storageKey?: string
}

interface HandleProps {
  onMouseDown: (e: React.MouseEvent) => void
  onTouchStart: (e: React.TouchEvent) => void
}

interface Return {
  height: number
  setHeight: (h: number) => void
  handleProps: HandleProps
}

const STORAGE_PREFIX = 'bakin-vresize:'

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function readStored(defaultHeight: number, min: number, max: number, storageKey?: string): number {
  if (!storageKey || typeof window === 'undefined') return clamp(defaultHeight, min, max)
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + storageKey)
    if (!raw) return clamp(defaultHeight, min, max)
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) ? clamp(parsed, min, max) : clamp(defaultHeight, min, max)
  } catch {
    return clamp(defaultHeight, min, max)
  }
}

/**
 * Resize a panel by dragging its top edge. The handle lives at the top of the
 * element; dragging upward grows the panel, dragging downward shrinks it.
 */
export function useVerticalResize({ defaultHeight, minHeight, maxHeight, storageKey }: Options): Return {
  const [height, setHeightState] = useState(() => readStored(defaultHeight, minHeight, maxHeight, storageKey))
  const heightRef = useRef(height)
  const dragging = useRef(false)
  const startY = useRef(0)
  const startHeight = useRef(0)

  useEffect(() => {
    heightRef.current = height
  }, [height])

  const persist = useCallback((h: number) => {
    if (!storageKey || typeof window === 'undefined') return
    try {
      window.localStorage.setItem(STORAGE_PREFIX + storageKey, String(clamp(h, minHeight, maxHeight)))
    } catch {
      // ignore storage failures
    }
  }, [storageKey, minHeight, maxHeight])

  const setHeight = useCallback((h: number) => {
    const next = clamp(h, minHeight, maxHeight)
    heightRef.current = next
    setHeightState(next)
    persist(next)
  }, [minHeight, maxHeight, persist])

  const beginDrag = useCallback((clientY: number) => {
    dragging.current = true
    startY.current = clientY
    startHeight.current = heightRef.current
  }, [])

  const onMove = useCallback((clientY: number) => {
    if (!dragging.current) return
    const delta = startY.current - clientY
    const next = clamp(startHeight.current + delta, minHeight, maxHeight)
    heightRef.current = next
    setHeightState(next)
  }, [minHeight, maxHeight])

  const endDrag = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    persist(heightRef.current)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [persist])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    beginDrag(e.clientY)
    const move = (ev: MouseEvent) => onMove(ev.clientY)
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      endDrag()
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [beginDrag, onMove, endDrag])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    if (!touch) return
    beginDrag(touch.clientY)
    const move = (ev: TouchEvent) => {
      const t = ev.touches[0]
      if (t) onMove(t.clientY)
    }
    const up = () => {
      document.removeEventListener('touchmove', move)
      document.removeEventListener('touchend', up)
      document.removeEventListener('touchcancel', up)
      endDrag()
    }
    document.addEventListener('touchmove', move)
    document.addEventListener('touchend', up)
    document.addEventListener('touchcancel', up)
  }, [beginDrag, onMove, endDrag])

  return {
    height,
    setHeight,
    handleProps: { onMouseDown, onTouchStart },
  }
}
