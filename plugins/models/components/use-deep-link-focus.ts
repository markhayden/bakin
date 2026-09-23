'use client'

import { useEffect } from 'react'

import type { SelectionsData } from './use-selections'

/**
 * Land a `?ref=` deep link on something you can see: scroll the element
 * carrying `data-selection-ref={ref}` into view and move focus to its first
 * control. The kit's focus ring is the visible marker on every surface
 * (rows add the selected tint on top). A ref this surface does not render
 * is a no-op, so every view calls it and only the owner lands — ONCE per
 * arrival (`sel.landed` lives with the page's data, so switching tabs or
 * views while `?ref=` stays in the URL never steals focus again).
 */
export function useDeepLinkFocus(sel: Pick<SelectionsData, 'highlightRef' | 'landed'>, ready: boolean): void {
  const ref = sel.highlightRef
  const landed = sel.landed
  useEffect(() => {
    if (!ref || !ready || landed.current === ref) return
    const host = document.querySelector<HTMLElement>(`[data-selection-ref="${ref.replace(/["\\]/g, '\\$&')}"]`)
    if (!host) return
    landed.current = ref
    // A control folded behind a closed disclosure (`<details>`, e.g. the
    // Overview's "More defaults") is not something you can see — open every
    // enclosing one before scrolling to it.
    for (let details = host.closest('details'); details; details = details.parentElement?.closest('details') ?? null) {
      details.open = true
    }
    host.scrollIntoView?.({ block: 'center' })
    const control = host.querySelector<HTMLElement>('[role="combobox"], button, input, select, textarea')
    control?.focus({ preventScroll: true })
  }, [ref, ready, landed])
}
