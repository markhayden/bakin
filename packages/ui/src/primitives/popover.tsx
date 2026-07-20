'use client'

import * as React from 'react'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'

import { cn, mergeClassName } from '../utils'
import { anchoredPopupClasses, anchoredPositionerClasses } from './option-list'

export type PopoverProps = PopoverPrimitive.Root.Props
export type PopoverTriggerProps = PopoverPrimitive.Trigger.Props
export type PopoverPortalProps = PopoverPrimitive.Portal.Props
export type PopoverContentProps = PopoverPrimitive.Popup.Props
  & Pick<PopoverPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset' | 'collisionAvoidance'>
  & { portalProps?: PopoverPortalProps }
export type PopoverHeaderProps = React.ComponentProps<'div'>
export type PopoverTitleProps = PopoverPrimitive.Title.Props
export type PopoverDescriptionProps = PopoverPrimitive.Description.Props

export function Popover(props: PopoverProps) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

export function PopoverTrigger(props: PopoverTriggerProps) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

export function PopoverPortal(props: PopoverPortalProps) {
  return <PopoverPrimitive.Portal data-slot="popover-portal" {...props} />
}

export function PopoverContent({
  className,
  align = 'center',
  alignOffset = 0,
  side = 'bottom',
  sideOffset = 8,
  collisionAvoidance,
  portalProps,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPortal {...portalProps}>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionAvoidance={collisionAvoidance}
        className={anchoredPositionerClasses}
      >
        <PopoverPrimitive.Popup
          {...props}
          data-slot="popover-content"
          className={mergeClassName(`${anchoredPopupClasses} flex w-72 flex-col gap-bakin-3 p-bakin-4`, className)}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPortal>
  )
}

export function PopoverHeader({ className, ...props }: PopoverHeaderProps) {
  return <div data-slot="popover-header" className={cn('flex min-w-0 flex-col gap-bakin-1', className)} {...props} />
}

export function PopoverTitle({ className, ...props }: PopoverTitleProps) {
  return <PopoverPrimitive.Title data-slot="popover-title" className={mergeClassName('text-[length:var(--bakin-typography-size-title)] font-bakin-typography-weight-semibold leading-tight text-bakin-text-primary', className)} {...props} />
}

export function PopoverDescription({ className, ...props }: PopoverDescriptionProps) {
  return <PopoverPrimitive.Description data-slot="popover-description" className={mergeClassName('text-pretty leading-relaxed text-bakin-text-muted', className)} {...props} />
}
