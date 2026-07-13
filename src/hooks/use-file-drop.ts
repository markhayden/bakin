'use client'

/**
 * useFileDrop — the headless drag-drop file intake every upload surface
 * repeats (drag-over state, dragOver/dragLeave/drop handlers, accept
 * filtering). Four components hand-rolled this dance; compose the hook and
 * style your own zone.
 */
import { useCallback, useState, type DragEvent } from 'react'

export interface UseFileDropOptions {
  /** MIME prefix/type filter, e.g. ['image/'] or ['image/', 'application/pdf']. Omit = accept all. */
  accept?: string[]
  multiple?: boolean
  onFiles: (files: File[]) => void
  /** Called when a drop contained ONLY rejected files — surface it, never swallow. */
  onRejected?: (files: File[]) => void
}

export interface UseFileDropResult {
  dragOver: boolean
  /** Spread onto the drop target. */
  dropProps: {
    onDragOver: (e: DragEvent) => void
    onDragLeave: (e: DragEvent) => void
    onDrop: (e: DragEvent) => void
  }
}

export function useFileDrop({ accept, multiple = false, onFiles, onRejected }: UseFileDropOptions): UseFileDropResult {
  const [dragOver, setDragOver] = useState(false)

  const matches = useCallback(
    (file: File) => !accept?.length || accept.some((a) => file.type.startsWith(a)),
    [accept],
  )

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])
  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }, [])
  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const all = Array.from(e.dataTransfer?.files ?? [])
      if (all.length === 0) return
      const accepted = all.filter(matches)
      const sliced = multiple ? accepted : accepted.slice(0, 1)
      if (sliced.length > 0) onFiles(sliced)
      else onRejected?.(all)
    },
    [matches, multiple, onFiles, onRejected],
  )

  return { dragOver, dropProps: { onDragOver, onDragLeave, onDrop } }
}
