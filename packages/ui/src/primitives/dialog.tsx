'use client'

import * as React from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'

import { cn, mergeClassName } from '../utils'
import { Button } from './button'
import {
  ModalBusyProvider,
  closeIcon,
  modalBackdropClasses,
  modalCloseButtonClasses,
  useModalBusy,
} from './modal-context'

export type DialogProps<Payload = unknown> = DialogPrimitive.Root.Props<Payload> & { busy?: boolean }
export type DialogTriggerProps<Payload = unknown> = DialogPrimitive.Trigger.Props<Payload>
export type DialogPortalProps = DialogPrimitive.Portal.Props
export type DialogCloseProps = DialogPrimitive.Close.Props
export type DialogOverlayProps = DialogPrimitive.Backdrop.Props
export type DialogContentProps = DialogPrimitive.Popup.Props & {
  closeLabel?: string
  overlayProps?: DialogOverlayProps
  portalProps?: DialogPortalProps
  showCloseButton?: boolean
}
export type DialogHeaderProps = React.ComponentProps<'div'>
export type DialogFooterProps = React.ComponentProps<'div'> & { showCloseButton?: boolean }
export type DialogTitleProps = DialogPrimitive.Title.Props
export type DialogDescriptionProps = DialogPrimitive.Description.Props

export function Dialog<Payload>({ busy = false, onOpenChange, children, ...props }: DialogProps<Payload>) {
  return (
    <ModalBusyProvider busy={busy}>
      <DialogPrimitive.Root
        data-slot="dialog"
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
      </DialogPrimitive.Root>
    </ModalBusyProvider>
  )
}

export function DialogTrigger<Payload>(props: DialogTriggerProps<Payload>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

export function DialogPortal(props: DialogPortalProps) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

export function DialogClose({ disabled, ...props }: DialogCloseProps) {
  const busy = useModalBusy()
  return <DialogPrimitive.Close data-slot="dialog-close" disabled={disabled || busy} {...props} />
}

export function DialogOverlay({ className, ...props }: DialogOverlayProps) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={mergeClassName(modalBackdropClasses, className)}
      {...props}
    />
  )
}

const dialogContentClasses = [
  'fixed left-1/2 top-1/2 z-50 grid max-h-[min(90dvh,52rem)] w-[calc(100%-var(--bakin-layout-space-8))] max-w-md',
  '-translate-x-1/2 -translate-y-1/2 gap-bakin-4 overflow-y-auto overscroll-contain rounded-bakin-overlay border border-bakin-border-subtle',
  'bg-bakin-surface-default p-bakin-6 font-bakin-typography-family-ui text-[length:var(--bakin-typography-size-body)] text-bakin-text-primary shadow-bakin-elevation-overlay outline-none',
  'transition-[opacity,transform] duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard',
  'data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0',
  'motion-reduce:transform-none motion-reduce:transition-none',
].join(' ')

export function DialogContent({
  className,
  children,
  closeLabel = 'Close dialog',
  overlayProps,
  portalProps,
  showCloseButton = true,
  ...props
}: DialogContentProps) {
  const busy = useModalBusy()
  return (
    <DialogPortal {...portalProps}>
      <DialogOverlay {...overlayProps} />
      <DialogPrimitive.Popup
        {...props}
        data-slot="dialog-content"
        aria-busy={busy || undefined}
        className={mergeClassName(dialogContentClasses, className)}
      >
        {children}
        {showCloseButton ? (
          <DialogClose
            render={<Button variant="ghost" size="icon-sm" className={modalCloseButtonClasses} aria-label={closeLabel} />}
          >
            {closeIcon(closeLabel)}
          </DialogClose>
        ) : null}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

export function DialogHeader({ className, ...props }: DialogHeaderProps) {
  return <div data-slot="dialog-header" className={cn('flex min-w-0 flex-col gap-bakin-2 pr-bakin-8', className)} {...props} />
}

export function DialogFooter({ className, showCloseButton = false, children, ...props }: DialogFooterProps) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('-mx-bakin-6 -mb-bakin-6 mt-bakin-2 flex flex-col-reverse gap-bakin-2 rounded-b-bakin-overlay border-t border-bakin-border-subtle bg-bakin-canvas-default p-bakin-4 sm:flex-row sm:justify-end', className)}
      {...props}
    >
      {children}
      {showCloseButton ? <DialogClose render={<Button variant="outline" />}>Close</DialogClose> : null}
    </div>
  )
}

export function DialogTitle({ className, ...props }: DialogTitleProps) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={mergeClassName('text-balance text-[length:var(--bakin-typography-size-title)] font-bakin-typography-weight-semibold leading-tight text-bakin-text-primary', className)}
      {...props}
    />
  )
}

export function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={mergeClassName('text-pretty leading-relaxed text-bakin-text-muted [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-bakin-text-primary', className)}
      {...props}
    />
  )
}
