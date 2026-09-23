'use client'

import { useEffect } from 'react'

/**
 * Land a `?ref=` deep link on something you can see: scroll the element
 * carrying `data-selection-ref={ref}` into view and move focus to its first
 * control. The kit's focus ring is the visible marker on every surface
 * (rows add the selected tint on top). Runs when the ref or the surface's
 * readiness changes; a ref this surface does not render is a no-op, so
 * every view calls it and only the owner lands.
 */
export function useDeepLinkFocus(ref: string | null, ready: boolean): void {
  useEffect(() => {
    if (!ref || !ready) return
    const host = document.querySelector<HTMLElement>(`[data-selection-ref="${ref.replace(/["\\]/g, '\\$&')}"]`)
    if (!host) return
    host.scrollIntoView?.({ block: 'center' })
    const control = host.querySelector<HTMLElement>('[role="combobox"], button, input, select, textarea')
    control?.focus({ preventScroll: true })
  }, [ref, ready])
}
