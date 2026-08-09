'use client'

import * as React from 'react'

import { layoutClassName } from './utils'

type BoundedOverflowName =
  | { label: string; labelledBy?: never }
  | { label?: never; labelledBy: string }

type BoundedOverflowBaseProps = Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'aria-label' | 'aria-labelledby' | 'role' | 'tabIndex'
>

export type BoundedOverflowProps = BoundedOverflowBaseProps & BoundedOverflowName & {
  /**
   * Pin an always-visible horizontal scrollbar to the viewport bottom. For
   * tall regions whose own bottom edge can sit below the fold (workspace
   * boards), the native bar is unreachable without scrolling the page
   * first — the pinned bar keeps sideways scrolling one gesture away at
   * all times. Rendered as a kit-owned track + thumb (native scrollbar
   * painting is overlay-dependent and can be invisible); the region keeps
   * keyboard scrolling and its accessible name.
   */
  stickyScrollbar?: boolean
}

const THUMB_MIN_PX = 48

/** Labelled keyboard-scrollable boundary for wide tables, charts, and canvases. */
export function BoundedOverflow({
  children,
  className,
  label,
  labelledBy,
  stickyScrollbar = false,
  ...props
}: BoundedOverflowProps) {
  const regionRef = React.useRef<HTMLDivElement>(null)
  const trackRef = React.useRef<HTMLDivElement>(null)
  const thumbRef = React.useRef<HTMLDivElement>(null)
  const [needsBar, setNeedsBar] = React.useState(false)

  React.useEffect(() => {
    if (!stickyScrollbar) return
    const region = regionRef.current
    const track = trackRef.current
    const thumb = thumbRef.current
    if (!region || !track || !thumb) return

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
      const progress = m.maxScroll > 0 ? region.scrollLeft / m.maxScroll : 0
      thumb.style.transform = `translateX(${Math.round(progress * m.range)}px)`
    }

    const update = () => {
      // Fixed positioning (viewport-anchored): sticky would be captured by
      // any overflow-hidden ancestor, which never scrolls, stranding the
      // bar below the fold. Geometry mirrors the region's box.
      const rect = region.getBoundingClientRect()
      track.style.left = `${rect.left}px`
      track.style.width = `${rect.width}px`
      setNeedsBar(region.scrollWidth > region.clientWidth + 1)
      paint()
    }

    update()
    const resize = new ResizeObserver(update)
    resize.observe(region)
    for (const child of region.children) resize.observe(child)
    region.addEventListener('scroll', paint, { passive: true })

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
      const m = metrics()
      region.scrollLeft = drag.startLeft + ((event.clientX - drag.startX) / m.range) * m.maxScroll
    }
    const onPointerUp = () => {
      drag = null
    }
    const onTrackWheel = (event: WheelEvent) => {
      region.scrollLeft += event.deltaX + event.deltaY
      event.preventDefault()
    }
    const onTrackClick = (event: MouseEvent) => {
      if (event.target === thumb) return
      const m = metrics()
      const rect = track.getBoundingClientRect()
      const target = (event.clientX - rect.left - m.thumbWidth / 2) / m.range
      region.scrollLeft = target * m.maxScroll
    }
    thumb.addEventListener('pointerdown', onPointerDown)
    thumb.addEventListener('pointermove', onPointerMove)
    thumb.addEventListener('pointerup', onPointerUp)
    track.addEventListener('wheel', onTrackWheel, { passive: false })
    track.addEventListener('mousedown', onTrackClick)
    return () => {
      resize.disconnect()
      region.removeEventListener('scroll', paint)
      thumb.removeEventListener('pointerdown', onPointerDown)
      thumb.removeEventListener('pointermove', onPointerMove)
      thumb.removeEventListener('pointerup', onPointerUp)
      track.removeEventListener('wheel', onTrackWheel)
      track.removeEventListener('mousedown', onTrackClick)
    }
  }, [stickyScrollbar])

  const region = (
    <div
      {...props}
      ref={regionRef}
      data-slot="bounded-overflow"
      role="region"
      aria-label={label}
      aria-labelledby={labelledBy}
      tabIndex={0}
      className={layoutClassName(
        'max-w-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain',
        'focus-visible:rounded-bakin-control focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring',
        stickyScrollbar && '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {children}
    </div>
  )

  if (!stickyScrollbar) return region

  return (
    <>
      {region}
      <div
        ref={trackRef}
        aria-hidden="true"
        data-slot="bounded-overflow-scrollbar"
        className={layoutClassName(
          'fixed bottom-0 z-20 h-bakin-3 cursor-pointer touch-none select-none bg-bakin-canvas-default/90 py-[3px]',
          !needsBar && 'hidden',
        )}
      >
        <div
          ref={thumbRef}
          data-slot="bounded-overflow-scrollbar-thumb"
          className="h-full rounded-bakin-pill bg-bakin-text-muted/40 transition-colors hover:bg-bakin-text-muted/70"
        />
      </div>
    </>
  )
}
