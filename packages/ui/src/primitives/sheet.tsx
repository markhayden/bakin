'use client'

import * as React from 'react'
import { Dialog as SheetPrimitive } from '@base-ui/react/dialog'

import { cn, mergeClassName } from '../utils'
import { Button } from './button'
import {
  ModalBusyProvider,
  closeIcon,
  modalBackdropClasses,
  modalCloseButtonClasses,
  useModalBusy,
} from './modal-context'
import { PluginPortalBoundary } from './portal-ownership'

export type SheetSide = 'top' | 'right' | 'bottom' | 'left'
export type SheetProps<Payload = unknown> = SheetPrimitive.Root.Props<Payload> & { busy?: boolean }
export type SheetTriggerProps<Payload = unknown> = SheetPrimitive.Trigger.Props<Payload>
export type SheetCloseProps = SheetPrimitive.Close.Props
export type SheetPortalProps = SheetPrimitive.Portal.Props
export type SheetOverlayProps = SheetPrimitive.Backdrop.Props
export type SheetContentProps = SheetPrimitive.Popup.Props & {
  closeLabel?: string
  overlayProps?: SheetOverlayProps
  portalProps?: SheetPortalProps
  showCloseButton?: boolean
  side?: SheetSide
}
export type SheetHeaderProps = React.ComponentProps<'div'> & {
  /** Use `none` when a containing composition already owns the horizontal inset. */
  inset?: 'default' | 'none'
}
export type SheetFooterProps = React.ComponentProps<'div'>
export type SheetTitleProps = SheetPrimitive.Title.Props
export type SheetDescriptionProps = SheetPrimitive.Description.Props

export function Sheet<Payload>({ busy = false, onOpenChange, children, ...props }: SheetProps<Payload>) {
  return (
    <ModalBusyProvider busy={busy}>
      <SheetPrimitive.Root
        data-slot="sheet"
        onOpenChange={(open, details) => {
          if (!open && busy) {
            details.cancel()
            return
          }
          onOpenChange?.(open, details)
        }}
        {...props}
      >
        {children}
      </SheetPrimitive.Root>
    </ModalBusyProvider>
  )
}

export function SheetTrigger<Payload>(props: SheetTriggerProps<Payload>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

export function SheetClose({ disabled, ...props }: SheetCloseProps) {
  const busy = useModalBusy()
  return <SheetPrimitive.Close data-slot="sheet-close" disabled={disabled || busy} {...props} />
}

export function SheetPortal({ children, ...props }: SheetPortalProps) {
  return (
    <SheetPrimitive.Portal data-slot="sheet-portal" {...props}>
      <PluginPortalBoundary>{children}</PluginPortalBoundary>
    </SheetPrimitive.Portal>
  )
}

export function SheetOverlay({ className, ...props }: SheetOverlayProps) {
  return <SheetPrimitive.Backdrop data-slot="sheet-overlay" className={mergeClassName(modalBackdropClasses, className)} {...props} />
}

const sheetContentClasses = [
  'fixed z-50 flex max-w-full flex-col gap-bakin-4 overflow-hidden border-bakin-border-subtle bg-bakin-surface-default',
  'font-bakin-typography-family-ui text-[length:var(--bakin-typography-size-body)] text-bakin-text-primary shadow-bakin-elevation-overlay outline-none',
  'transition-[opacity,transform] duration-[var(--bakin-motion-duration-deliberate)] ease-bakin-standard',
  'data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:transition-none',
  'data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-dvh data-[side=right]:w-full data-[side=right]:border-l data-[side=right]:sm:w-3/4 data-[side=right]:sm:max-w-xl',
  'data-[side=right]:data-starting-style:translate-x-bakin-10 data-[side=right]:data-ending-style:translate-x-bakin-10',
  'data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-dvh data-[side=left]:w-full data-[side=left]:border-r data-[side=left]:sm:w-3/4 data-[side=left]:sm:max-w-xl',
  'data-[side=left]:data-starting-style:-translate-x-bakin-10 data-[side=left]:data-ending-style:-translate-x-bakin-10',
  'data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:max-h-[calc(100dvh-var(--bakin-layout-space-4))] data-[side=bottom]:w-full data-[side=bottom]:rounded-t-bakin-overlay data-[side=bottom]:border-t',
  'data-[side=bottom]:data-starting-style:translate-y-bakin-10 data-[side=bottom]:data-ending-style:translate-y-bakin-10',
  'data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:max-h-[calc(100dvh-var(--bakin-layout-space-4))] data-[side=top]:w-full data-[side=top]:rounded-b-bakin-overlay data-[side=top]:border-b',
  'data-[side=top]:data-starting-style:-translate-y-bakin-10 data-[side=top]:data-ending-style:-translate-y-bakin-10',
  'motion-reduce:transform-none',
].join(' ')

export function SheetContent({
  className,
  children,
  closeLabel = 'Close panel',
  overlayProps,
  portalProps,
  showCloseButton = true,
  side = 'right',
  ...props
}: SheetContentProps) {
  const busy = useModalBusy()
  return (
    <SheetPortal {...portalProps}>
      <SheetOverlay {...overlayProps} />
      <SheetPrimitive.Popup
        {...props}
        data-slot="sheet-content"
        data-side={side}
        aria-busy={busy || undefined}
        className={mergeClassName(sheetContentClasses, className)}
      >
        {children}
        {showCloseButton ? (
          <SheetClose
            render={<Button variant="ghost" size="icon-sm" className={modalCloseButtonClasses} aria-label={closeLabel} />}
          >
            {closeIcon(closeLabel)}
          </SheetClose>
        ) : null}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

export function SheetHeader({ className, inset = 'default', ...props }: SheetHeaderProps) {
  return (
    <div
      data-slot="sheet-header"
      data-inset={inset}
      className={cn('flex min-w-0 flex-col gap-bakin-1', inset === 'default' && 'p-bakin-6 pr-bakin-12', className)}
      {...props}
    />
  )
}

export function SheetFooter({ className, ...props }: SheetFooterProps) {
  return <div data-slot="sheet-footer" className={cn('mt-auto flex flex-col gap-bakin-2 border-t border-bakin-border-subtle p-bakin-6 sm:flex-row sm:justify-end', className)} {...props} />
}

export function SheetTitle({ className, ...props }: SheetTitleProps) {
  return <SheetPrimitive.Title data-slot="sheet-title" className={mergeClassName('text-[length:var(--bakin-typography-size-title)] font-bakin-typography-weight-semibold leading-tight text-bakin-text-primary', className)} {...props} />
}

export function SheetDescription({ className, ...props }: SheetDescriptionProps) {
  return <SheetPrimitive.Description data-slot="sheet-description" className={mergeClassName('leading-relaxed text-bakin-text-muted', className)} {...props} />
}
