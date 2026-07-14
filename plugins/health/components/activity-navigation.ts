'use client'

export function focusActivityElement(
  element: HTMLElement,
  {
    block = 'start',
    hash = '#activity-needs-attention',
  }: {
    block?: ScrollLogicalPosition
    hash?: string
  } = {},
) {
  if (window.location.hash !== hash) window.history.pushState(null, '', hash)
  element.scrollIntoView({
    behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block,
  })
  element.focus({ preventScroll: true })
}
