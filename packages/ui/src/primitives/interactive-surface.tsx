import * as React from 'react'

import { cn } from '../utils'

/**
 * The one whole-surface activation contract, shared by Card and ListRow:
 * a single absolutely-positioned overlay control (button, or `render` for
 * links) carries the surface's action with a real focus ring, while content
 * stays visible above it and nested controls keep their own behavior.
 */
export interface InteractiveAction {
  /** Accessible name for the whole-surface action. */
  label: string
  /** Activation handler; used when `render` is not supplied. */
  onActivate?: (event: React.SyntheticEvent) => void
  /** Custom overlay element for navigation semantics (e.g. a client-routed link). */
  render?: React.ReactElement<{ className?: string }>
}

const overlayClassName =
  'absolute inset-0 z-0 cursor-pointer rounded-bakin-surface outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring'

export function interactiveOverlay(interactive: InteractiveAction): React.ReactElement {
  if (interactive.render) {
    return React.cloneElement(interactive.render, {
      ...{ 'data-slot': 'surface-overlay', 'aria-label': interactive.label },
      className: cn(overlayClassName, interactive.render.props.className),
    })
  }
  return (
    <button
      type="button"
      data-slot="surface-overlay"
      aria-label={interactive.label}
      className={overlayClassName}
      onClick={interactive.onActivate}
    />
  )
}

/**
 * Root classes for a surface hosting the overlay: hover affordance plus the
 * click-through discipline — direct children paint above the overlay but let
 * clicks fall through to it, while real nested controls stay independent.
 */
export const interactiveSurfaceClasses = [
  'data-[interactive]:transition-colors data-[interactive]:hover:bg-bakin-surface-elevated motion-reduce:transition-none',
  // Direct children fall through to the overlay — except controls, which stay
  // independent whether they sit at the surface root or deeper.
  'data-[interactive]:[&>*:not([data-slot=surface-overlay],[data-slot=list-row-actions],a,button,input,select,textarea,[role=button],[tabindex])]:pointer-events-none',
  'data-[interactive]:[&>*:not([data-slot=surface-overlay],[data-slot=list-row-actions])]:relative data-[interactive]:[&>*:not([data-slot=surface-overlay],[data-slot=list-row-actions])]:z-[1]',
  'data-[interactive]:[&_:is(a,button,input,select,textarea,[role=button],[tabindex])]:pointer-events-auto',
].join(' ')
