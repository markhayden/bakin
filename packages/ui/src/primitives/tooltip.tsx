'use client'

import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'

import { mergeClassName } from '../utils'
import { anchoredPositionerClasses } from './option-list'

export type TooltipProviderProps = TooltipPrimitive.Provider.Props
export type TooltipProps = TooltipPrimitive.Root.Props
export type TooltipTriggerProps = TooltipPrimitive.Trigger.Props
export type TooltipPortalProps = TooltipPrimitive.Portal.Props
export type TooltipContentProps = TooltipPrimitive.Popup.Props
  & Pick<TooltipPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset' | 'collisionAvoidance'>
  & { portalProps?: TooltipPortalProps; showArrow?: boolean }

export function TooltipProvider({ delay = 400, ...props }: TooltipProviderProps) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />
}

export function Tooltip(props: TooltipProps) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

export function TooltipTrigger(props: TooltipTriggerProps) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

export function TooltipPortal(props: TooltipPortalProps) {
  return <TooltipPrimitive.Portal data-slot="tooltip-portal" {...props} />
}

const tooltipClasses = [
  'z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-bakin-2 rounded-bakin-control',
  'bg-bakin-text-primary px-bakin-3 py-bakin-2 font-bakin-typography-family-ui text-[length:var(--bakin-typography-size-meta)] leading-snug text-bakin-canvas-default shadow-bakin-elevation-overlay',
  'transition-[opacity,transform] duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard',
  'data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0',
  'motion-reduce:transform-none motion-reduce:transition-none',
].join(' ')

export function TooltipContent({
  className,
  side = 'top',
  sideOffset = 8,
  align = 'center',
  alignOffset = 0,
  collisionAvoidance,
  children,
  portalProps,
  showArrow = true,
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPortal {...portalProps}>
      <TooltipPrimitive.Positioner align={align} alignOffset={alignOffset} side={side} sideOffset={sideOffset} collisionAvoidance={collisionAvoidance} className={anchoredPositionerClasses}>
        <TooltipPrimitive.Popup {...props} role="tooltip" data-slot="tooltip-content" className={mergeClassName(tooltipClasses, className)}>
          <span data-slot="tooltip-copy" className="relative z-[1] min-w-0">{children}</span>
          {showArrow ? <TooltipPrimitive.Arrow className="size-bakin-2 rotate-45 rounded-[1px] bg-bakin-text-primary fill-bakin-text-primary" /> : null}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPortal>
  )
}
