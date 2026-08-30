'use client'

import * as React from 'react'

import { layoutClassName } from './utils'

const THUMB_MIN_PX = 48
const LINE_MODE_PX = 16

/**
 * The pinned horizontal scrollbar behind `BoundedOverflow stickyScrollbar`:
 * a kit-owned track + thumb fixed to the visible bottom edge,
 * bidirectionally synced with the region. Lives outside the presentational
 * layout vocabulary because it is genuinely interactive (observers,
 * pointer capture, viewport geometry).
 */
export function StickyOverflowScrollbar({
  regionRef,
}: {
  regionRef: React.RefObject<HTMLDivElement | null>
}) {
  const trackRef = React.useRef<HTMLDivElement>(null)
  const thumbRef = React.useRef<HTMLDivElement>(null)
  const [needsBar, setNeedsBar] = React.useState(false)

  React.useEffect(() => {
    const region = regionRef.current
    const track = trackRef.current
    const thumb = thumbRef.current
    if (!region || !track || !thumb) return

    // RTL: scrollLeft runs 0 → negative; normalize progress and drag.
    const dir = () => (getComputedStyle(region).direction === 'rtl' ? -1 : 1)

    const metrics = () => {
      const maxScroll = region.scrollWidth - region.clientWidth
      const trackWidth = track.clientWidth
      const thumbWidth = Math.max(
        THUMB_MIN_PX,
        Math.round(trackWidth * (region.clientWidth / Math.max(1, region.scrollWidth))),
      )
      return { maxScroll, trackWidth, thumbWidth, range: Math.max(1, trackWidth - thumbWidth) }
    }

    const paint = () => {
      const m = metrics()
      thumb.style.width = `${m.thumbWidth}px`
      const progress = m.maxScroll > 0 ? Math.abs(region.scrollLeft) / m.maxScroll : 0
      thumb.style.transform = `translateX(${Math.round(progress * m.range) * dir()}px)`
    }

    const update = () => {
      // Fixed positioning (viewport-anchored): sticky would be captured by
      // any overflow-hidden ancestor, which never scrolls, stranding the
      // bar below the fold. Geometry mirrors the region's box, clamped to
      // the region's visible extent so the bar attaches to the region's
      // bottom edge when that edge is on screen and hides when the region
      // leaves the viewport entirely.
      const rect = region.getBoundingClientRect()
      const viewportH = globalThis.innerHeight
      track.style.left = `${rect.left}px`
      track.style.width = `${rect.width}px`
      track.style.bottom = `${Math.max(0, viewportH - Math.min(rect.bottom, viewportH))}px`
      const offScreen = rect.bottom <= 0 || rect.top >= viewportH
      setNeedsBar(!offScreen && region.scrollWidth > region.clientWidth + 1)
      paint()
    }

    update()
    const resize = new ResizeObserver(update)
    resize.observe(region)
    for (const child of region.children) resize.observe(child)
    region.addEventListener('scroll', paint, { passive: true })
    // Ancestor scrolls move the region's viewport rect; capture phase sees
    // scroll events from any scroll container above the region.
    globalThis.addEventListener('scroll', update, { capture: true, passive: true })
    globalThis.addEventListener('resize', update)

    // Thumb drag maps 1:1 onto region scroll; track wheel accepts either
    // axis so a mouse wheel over the bar scrolls the board sideways.
    let drag: { startX: number; startLeft: number } | null = null
    const onPointerDown = (event: PointerEvent) => {
      drag = { startX: event.clientX, startLeft: region.scrollLeft }
      thumb.setPointerCapture(event.pointerId)
      event.preventDefault()
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!drag) return
      // A cancelled drag (system gesture, window blur) can strand state;
      // no buttons down means the drag is over regardless of events seen.
      if (event.buttons === 0) {
        drag = null
        return
      }
      const m = metrics()
      region.scrollLeft = drag.startLeft + (((event.clientX - drag.startX) / m.range) * m.maxScroll) * dir()
    }
    const endDrag = () => {
      drag = null
    }
    const onTrackWheel = (event: WheelEvent) => {
      const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_MODE_PX : 1
      region.scrollLeft += (event.deltaX + event.deltaY) * scale
      event.preventDefault()
    }
    const onTrackClick = (event: MouseEvent) => {
      if (event.target === thumb) return
      const m = metrics()
      const rect = track.getBoundingClientRect()
      const target = (event.clientX - rect.left - m.thumbWidth / 2) / m.range
      region.scrollLeft = target * m.maxScroll * dir()
    }
    thumb.addEventListener('pointerdown', onPointerDown)
    thumb.addEventListener('pointermove', onPointerMove)
    thumb.addEventListener('pointerup', endDrag)
    thumb.addEventListener('pointercancel', endDrag)
    track.addEventListener('wheel', onTrackWheel, { passive: false })
    track.addEventListener('mousedown', onTrackClick)
    return () => {
      resize.disconnect()
      region.removeEventListener('scroll', paint)
      globalThis.removeEventListener('scroll', update, { capture: true })
      globalThis.removeEventListener('resize', update)
      thumb.removeEventListener('pointerdown', onPointerDown)
      thumb.removeEventListener('pointermove', onPointerMove)
      thumb.removeEventListener('pointerup', endDrag)
      thumb.removeEventListener('pointercancel', endDrag)
      track.removeEventListener('wheel', onTrackWheel)
      track.removeEventListener('mousedown', onTrackClick)
    }
  }, [regionRef])

  return (
    <div
      ref={trackRef}
      aria-hidden="true"
      data-slot="bounded-overflow-scrollbar"
      className={layoutClassName(
        // The safe-area padding-bottom guards the iOS home indicator when the region runs
        // to the true viewport bottom.
        'fixed bottom-0 z-20 h-bakin-3 cursor-pointer touch-none select-none bg-bakin-canvas-default/90 py-[3px] mb-[env(safe-area-inset-bottom)]',
        !needsBar && 'hidden',
      )}
    >
      <div
        ref={thumbRef}
        data-slot="bounded-overflow-scrollbar-thumb"
        className="h-full rounded-bakin-pill bg-bakin-text-muted/40 transition-colors hover:bg-bakin-text-muted/70"
      />
    </div>
  )
}
