import { useCallback, useLayoutEffect, type RefObject } from 'react'

/** Browser-measured rows; Firefox does not yet implement CSS field-sizing. */
export function useTextareaAutosize(ref: RefObject<HTMLTextAreaElement | null>, enabled: boolean, minRows: number, maxRows: number) {
  const resize = useCallback(() => {
    const element = ref.current
    if (!enabled || !element || !element.isConnected) return
    const style = getComputedStyle(element)
    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5
    if (!Number.isFinite(line)) return
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
    const minimum = line * minRows + padding + border
    const maximum = line * maxRows + padding + border
    const scrollTop = element.scrollTop
    element.style.height = '0px'
    const content = element.scrollHeight + border
    element.style.height = `${Math.max(minimum, Math.min(maximum, content))}px`
    element.style.overflowY = content > maximum ? 'auto' : 'hidden'
    element.scrollTop = scrollTop
  }, [enabled, maxRows, minRows, ref])

  useLayoutEffect(resize)

  useLayoutEffect(() => {
    const element = ref.current
    if (!enabled || !element) return
    let active = true
    let width = element.getBoundingClientRect().width
    const observer = new ResizeObserver(() => {
      const nextWidth = element.getBoundingClientRect().width
      if (nextWidth === width) return
      width = nextWidth
      resize()
    })
    observer.observe(element)
    const reset = () => queueMicrotask(() => { if (active) resize() })
    const form = element.form
    form?.addEventListener('reset', reset)
    window.addEventListener('resize', resize)
    document.fonts?.addEventListener('loadingdone', resize)
    void document.fonts?.ready.then(() => { if (active) resize() })
    return () => {
      active = false
      observer.disconnect()
      form?.removeEventListener('reset', reset)
      window.removeEventListener('resize', resize)
      document.fonts?.removeEventListener('loadingdone', resize)
      element.style.removeProperty('height')
      element.style.removeProperty('overflow-y')
    }
  }, [enabled, ref, resize])

  return resize
}
