'use client'

import { useResizablePane, type ResizeHandleProps } from './use-resizable-pane'

interface Options {
  defaultHeight: number
  minHeight: number
  maxHeight: number
  /** When set, height is persisted in localStorage under `bakin-vresize:${storageKey}`. */
  storageKey?: string
}

interface Return {
  height: number
  setHeight: (h: number) => void
  handleProps: ResizeHandleProps
}

/**
 * Resize a bottom-anchored panel by dragging its top edge. The handle lives at
 * the top of the element; dragging upward grows the panel, dragging downward
 * shrinks it. Keyboard: ArrowUp/ArrowDown (Shift for a larger step). Thin
 * wrapper over {@link useResizablePane}.
 */
export function useVerticalResize({ defaultHeight, minHeight, maxHeight, storageKey }: Options): Return {
  const { size, setSize, handleProps } = useResizablePane({
    axis: 'y',
    defaultSize: defaultHeight,
    minSize: minHeight,
    maxSize: maxHeight,
    storageKey,
    storagePrefix: 'bakin-vresize:',
  })
  return { height: size, setHeight: setSize, handleProps }
}
