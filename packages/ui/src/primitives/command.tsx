'use client'

import * as React from 'react'
import { Command as CommandPrimitive, useCommandState } from 'cmdk'

import { cn, mergeClassName } from '../utils'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, type DialogContentProps, type DialogProps } from './dialog'
import { InputGroup, InputGroupAddon } from './input-group'
import { optionGroupClasses, optionItemClasses, optionListClasses, optionSeparatorClasses } from './option-list'

type WithStringClassName<Props> = Omit<Props, 'className'> & { className?: string }

export type CommandProps = WithStringClassName<React.ComponentProps<typeof CommandPrimitive>>
export type CommandDialogProps = Omit<DialogProps, 'children'> & {
  children: React.ReactNode
  className?: string
  contentProps?: Omit<DialogContentProps, 'children' | 'className' | 'showCloseButton'>
  description?: string
  showCloseButton?: boolean
  title?: string
}
export type CommandInputProps = WithStringClassName<React.ComponentProps<typeof CommandPrimitive.Input>>
export type CommandListProps = WithStringClassName<React.ComponentProps<typeof CommandPrimitive.List>>
export type CommandEmptyProps = WithStringClassName<React.ComponentProps<typeof CommandPrimitive.Empty>>
export type CommandGroupProps = WithStringClassName<React.ComponentProps<typeof CommandPrimitive.Group>>
export type CommandSeparatorProps = React.ComponentProps<'div'> & { alwaysRender?: boolean }
export type CommandItemProps = WithStringClassName<React.ComponentProps<typeof CommandPrimitive.Item>> & { checked?: boolean }
export type CommandShortcutProps = React.ComponentProps<'span'>

export function Command({ className, label = 'Command menu', ...props }: CommandProps) {
  return <CommandPrimitive data-slot="command" label={label} className={cn('flex size-full min-w-0 flex-col overflow-hidden rounded-bakin-overlay bg-bakin-surface-default text-bakin-text-primary', className)} {...props} />
}

export function CommandDialog({
  title = 'Command palette',
  description = 'Search for an action to run.',
  children,
  className,
  contentProps,
  showCloseButton = false,
  ...props
}: CommandDialogProps) {
  return (
    <Dialog {...props}>
      <DialogContent {...contentProps} className={mergeClassName('top-[35%] max-h-[min(80dvh,40rem)] overflow-hidden p-0', className)} showCloseButton={showCloseButton}>
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

export function CommandInput({ className, ...props }: CommandInputProps) {
  return (
    <div data-slot="command-input-wrapper" className="border-b border-bakin-border-subtle p-bakin-2">
      <InputGroup className="border-transparent bg-bakin-canvas-default shadow-none">
        <CommandPrimitive.Input data-slot="command-input" className={cn('w-full bg-transparent text-[length:var(--bakin-typography-size-body)] text-bakin-text-primary outline-none disabled:cursor-not-allowed disabled:opacity-[var(--bakin-state-opacity-disabled)]', className)} {...props} />
        <InputGroupAddon align="inline-start">
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4 fill-none stroke-current stroke-[1.75]">
            <circle cx="7" cy="7" r="4.25" /><path d="m10.25 10.25 3 3" strokeLinecap="round" />
          </svg>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

export function CommandList({ className, ...props }: CommandListProps) {
  return <CommandPrimitive.List data-slot="command-list" className={cn(optionListClasses, 'max-h-80 scroll-py-bakin-1 overflow-x-hidden overflow-y-auto overscroll-contain outline-none', className)} {...props} />
}

export function CommandEmpty({ className, ...props }: CommandEmptyProps) {
  return <CommandPrimitive.Empty data-slot="command-empty" className={cn('px-bakin-4 py-bakin-8 text-center text-bakin-text-muted', className)} {...props} />
}

export function CommandGroup({ className, ...props }: CommandGroupProps) {
  return <CommandPrimitive.Group data-slot="command-group" className={cn(optionGroupClasses, '[&_[cmdk-group-heading]]:px-bakin-2 [&_[cmdk-group-heading]]:pb-bakin-1 [&_[cmdk-group-heading]]:pt-bakin-2 [&_[cmdk-group-heading]]:font-bakin-typography-family-ui [&_[cmdk-group-heading]]:text-[length:var(--bakin-typography-size-meta)] [&_[cmdk-group-heading]]:font-bakin-typography-weight-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[.08em] [&_[cmdk-group-heading]]:text-bakin-text-muted', className)} {...props} />
}

export function CommandSeparator({ alwaysRender = false, className, ...props }: CommandSeparatorProps) {
  const searching = useCommandState((state) => state.search.length > 0)
  if (searching && !alwaysRender) return null
  return <div {...props} role="presentation" aria-hidden="true" data-slot="command-separator" className={cn(optionSeparatorClasses, className)} />
}

export function CommandItem({ className, children, checked = false, ...props }: CommandItemProps) {
  return (
    <CommandPrimitive.Item {...props} data-slot="command-item" data-checked={checked || undefined} className={cn(optionItemClasses, 'group/command-item data-[selected=true]:bg-bakin-border-subtle/35 data-[selected=true]:text-bakin-text-primary', className)}>
      {children}
      <svg aria-hidden="true" viewBox="0 0 16 16" className="ml-auto hidden size-bakin-4 shrink-0 fill-none stroke-current stroke-[2.25] group-data-[checked=true]/command-item:block group-has-[[data-slot=command-shortcut]]/command-item:hidden">
        <path d="m3.25 8.25 3 3 6.5-7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </CommandPrimitive.Item>
  )
}

export function CommandShortcut({ className, 'aria-hidden': ariaHidden = true, ...props }: CommandShortcutProps) {
  return <span data-slot="command-shortcut" aria-hidden={ariaHidden} className={cn('ml-auto pl-bakin-4 font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)] tracking-wide text-bakin-text-muted', className)} {...props} />
}
