import * as React from 'react'

/** Bound only this workspace to the visible intersection of its host pane. */
export function useWorkspaceViewport(enabled: boolean) {
  const ref = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    const owner = ref.current
    const viewport = window.visualViewport
    if (!enabled || !owner || !viewport) return
    let frame = 0
    const measure = () => {
      frame = 0
      const rect = owner.getBoundingClientRect()
      const top = Math.max(rect.top, viewport.offsetTop)
      const left = Math.max(rect.left, viewport.offsetLeft)
      // VisualViewport dimensions and DOMRects are already in CSS pixels;
      // multiplying by scale would count pinch zoom twice.
      const dimensions = {
        '--bakin-workspace-viewport-height': Math.max(0, Math.min(rect.bottom, viewport.offsetTop + viewport.height) - top),
        '--bakin-workspace-viewport-width': Math.max(0, Math.min(rect.right, viewport.offsetLeft + viewport.width) - left),
        '--bakin-workspace-viewport-top': top - rect.top,
        '--bakin-workspace-viewport-left': left - rect.left,
      }
      // Internal measured geometry, like the kit's autosizing textarea and
      // sticky scrollbar. These are not consumer-supplied visual styles.
      for (const [name, value] of Object.entries(dimensions)) {
        owner.style.setProperty(name, `${value}px`)
      }
      // A keyboard/panned viewport ends above the device's home indicator.
      owner.style.setProperty('--bakin-workspace-safe-area-bottom', viewport.offsetTop + viewport.height < rect.bottom - 1 ? '0px' : 'env(safe-area-inset-bottom)')
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    const resize = new ResizeObserver(schedule)
    resize.observe(owner)
    viewport.addEventListener('resize', schedule)
    viewport.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    measure()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      viewport.removeEventListener('resize', schedule)
      viewport.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      for (const name of ['height', 'width', 'top', 'left']) owner.style.removeProperty(`--bakin-workspace-viewport-${name}`)
      owner.style.removeProperty('--bakin-workspace-safe-area-bottom')
    }
  }, [enabled])

  return ref
}
