/**
 * The tour: a few slides, one per area of Bakin, in a dialog.
 *
 * Offered on Home and never opened by itself. Which slide is open lives in
 * the URL (`/?tour=<slide id>`), so a slide can be linked to and a reload
 * keeps your place. Moving between slides replaces the entry, as all URL
 * state here does: the browser's Back leaves the tour, it does not step
 * through it. The slides are curated data served by
 * `GET /api/plugins/home/tour`; nothing here knows what they say.
 *
 * Pattern: `storybook/public/overlays/dialog.stories.tsx`
 * (ControlledFocusReturn): a controlled dialog with a title, a
 * description and its actions in the footer. Slides are text and an icon.
 */
import { useEffect } from 'react'
import { CalendarClock, CheckSquare, FolderOpen, HeartPulse, MessageSquare, Users, type LucideIcon } from 'lucide-react'
import { toast, usePluginJsonFetch } from '@makinbakin/sdk/hooks'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@makinbakin/sdk/ui'
import type { HomeTourResponse, TourSlide } from '../types'

/** `/?tour=<slide id>`: the tour is open on that slide. */
export const TOUR_PARAM = 'tour'
/** Any value that is not a slide opens the first one. */
export const TOUR_START = 'start'

const ICONS: Record<TourSlide['icon'], LucideIcon> = { CalendarClock, CheckSquare, FolderOpen, HeartPulse, MessageSquare, Users }

export interface TourProps {
  /** The `tour` query value: a slide id, anything else for the first slide, empty when closed. */
  slideId: string
  /** Move to a slide, or close with an empty id. */
  onSlide: (slideId: string) => void
}

export function Tour({ slideId, onSlide }: TourProps) {
  const open = slideId !== ''
  const { data, error } = usePluginJsonFetch<HomeTourResponse>('home', open ? 'tour' : null)

  // Nothing to show: say so and put the tour away, never an empty dialog.
  useEffect(() => {
    if (!open || !error) return
    toast("The tour couldn't be loaded. Try again.", 'error')
    onSlide('')
  }, [error, onSlide, open])

  const slides = data?.slides ?? []
  if (!open || slides.length === 0) return null
  const found = slides.findIndex((slide) => slide.id === slideId)
  const index = found === -1 ? 0 : found
  const slide = slides[index]!
  const last = index === slides.length - 1
  const Icon = ICONS[slide.icon]

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onSlide('') }}>
      <DialogContent closeLabel="Close the tour" data-home-tour={slide.id}>
        <DialogHeader>
          <p className="text-bakin-text-muted" aria-live="polite">{index + 1} of {slides.length}</p>
          <DialogTitle className="flex items-center gap-bakin-2">
            <Icon aria-hidden="true" className="size-bakin-6 shrink-0 text-bakin-signal-accent" />
            {slide.title}
          </DialogTitle>
          <DialogDescription>{slide.body}</DialogDescription>
        </DialogHeader>
        <p>
          <span className="font-bakin-typography-weight-semibold">Try this first: </span>
          {slide.first}
        </p>
        <p><PluginLink to={slide.href} className="underline underline-offset-4">Open {slide.title}</PluginLink></p>
        <DialogFooter>
          {index > 0 ? <Button variant="outline" onClick={() => onSlide(slides[index - 1]!.id)}>Back</Button> : null}
          {last
            ? <Button onClick={() => onSlide('')}>Done</Button>
            : <Button onClick={() => onSlide(slides[index + 1]!.id)}>Next: {slides[index + 1]!.title}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
