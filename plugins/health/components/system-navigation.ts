'use client'

/** Focus and reveal System evidence without violating reduced-motion preferences. */
export function focusSystemElement(
  element: HTMLElement,
  { block = 'start' }: { block?: ScrollLogicalPosition } = {},
): void {
  element.focus({ preventScroll: true })
  element.scrollIntoView?.({
    behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block,
  })
}
