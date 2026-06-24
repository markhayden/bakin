'use client'

import { useResizablePane, type ResizeHandleProps } from './use-resizable-pane'

interface Options {
  defaultWidth: number
  minWidth: number
  maxWidth: number
  /** When set, width is persisted in localStorage under `bakin-hresize:${storageKey}`. */
  storageKey?: string
}

interface Return {
  width: number
  setWidth: (w: number) => void
  handleProps: ResizeHandleProps
}

/**
 * Resize a right-anchored panel by dragging its left edge. The handle lives at
 * the left of the element; dragging left grows the panel, dragging right
 * shrinks it. Keyboard: ArrowLeft/ArrowRight (Shift for a larger step). The
 * companion to {@link useVerticalResize} for side-by-side split panes; both are
 * thin wrappers over {@link useResizablePane}.
 */
export function useHorizontalResize({ defaultWidth, minWidth, maxWidth, storageKey }: Options): Return {
  const { size, setSize, handleProps } = useResizablePane({
    axis: 'x',
    defaultSize: defaultWidth,
    minSize: minWidth,
    maxSize: maxWidth,
    storageKey,
    storagePrefix: 'bakin-hresize:',
  })
  return { width: size, setWidth: setSize, handleProps }
}
