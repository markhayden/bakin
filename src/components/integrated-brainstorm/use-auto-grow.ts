'use client'

import { useLayoutEffect, useRef } from 'react'

/**
 * Drive a textarea's height from its content. Grows up to `maxHeight` px,
 * then internal scroll kicks in. No native resize grip. Pair with a
 * resize-none textarea.
 */
export function useAutoGrow(value: string, maxHeight: number) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Reset to a small baseline so scrollHeight reflects the new content,
    // not the previously-measured height.
    el.style.height = 'auto'
    const desired = el.scrollHeight
    const capped = Math.min(desired, maxHeight)
    el.style.height = `${capped}px`
    el.style.overflowY = desired > maxHeight ? 'auto' : 'hidden'
  }, [value, maxHeight])

  return ref
}
