'use client'

import * as React from 'react'
import { Menu as MenuPrimitive } from '@base-ui/react/menu'

import { cn, mergeClassName } from '../utils'
import {
  anchoredPositionerClasses,
  optionGroupClasses,
  optionGroupLabelClasses,
  optionItemClasses,
  optionPopupClasses,
  optionSeparatorClasses,
} from './option-list'

export type DropdownMenuProps = MenuPrimitive.Root.Props
export type DropdownMenuPortalProps = MenuPrimitive.Portal.Props
export type DropdownMenuTriggerProps = MenuPrimitive.Trigger.Props
export type DropdownMenuContentProps = MenuPrimitive.Popup.Props
  & Pick<MenuPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset' | 'collisionAvoidance'>
  & { portalProps?: DropdownMenuPortalProps }
export type DropdownMenuGroupProps = MenuPrimitive.Group.Props
export type DropdownMenuLabelProps = MenuPrimitive.GroupLabel.Props & { inset?: boolean }
export type DropdownMenuItemVariant = 'default' | 'danger' | 'destructive'
export type DropdownMenuItemProps = MenuPrimitive.Item.Props & { inset?: boolean; variant?: DropdownMenuItemVariant }
export type DropdownMenuSubProps = MenuPrimitive.SubmenuRoot.Props
export type DropdownMenuSubTriggerProps = MenuPrimitive.SubmenuTrigger.Props & { inset?: boolean }
export type DropdownMenuSubContentProps = DropdownMenuContentProps
export type DropdownMenuCheckboxItemProps = MenuPrimitive.CheckboxItem.Props & { inset?: boolean }
export type DropdownMenuRadioGroupProps = MenuPrimitive.RadioGroup.Props
export type DropdownMenuRadioItemProps = MenuPrimitive.RadioItem.Props & { inset?: boolean }
export type DropdownMenuSeparatorProps = MenuPrimitive.Separator.Props
export type DropdownMenuShortcutProps = React.ComponentProps<'span'>

export function DropdownMenu(props: DropdownMenuProps) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

export function DropdownMenuPortal(props: DropdownMenuPortalProps) {
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
}

export function DropdownMenuTrigger(props: DropdownMenuTriggerProps) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

export function DropdownMenuContent({
  align = 'start',
  alignOffset = 0,
  side = 'bottom',
  sideOffset = 8,
  collisionAvoidance,
  className,
  portalProps,
  ...props
}: DropdownMenuContentProps) {
  return (
    <DropdownMenuPortal {...portalProps}>
      <MenuPrimitive.Positioner
        className={anchoredPositionerClasses}
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionAvoidance={collisionAvoidance}
      >
        <MenuPrimitive.Popup
          {...props}
          data-slot="dropdown-menu-content"
          className={mergeClassName(`${optionPopupClasses} min-w-40 p-bakin-1`, className)}
        />
      </MenuPrimitive.Positioner>
    </DropdownMenuPortal>
  )
}

export function DropdownMenuGroup({ className, ...props }: DropdownMenuGroupProps) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" className={mergeClassName(optionGroupClasses, className)} {...props} />
}

export function DropdownMenuLabel({ className, inset, ...props }: DropdownMenuLabelProps) {
  return <MenuPrimitive.GroupLabel data-slot="dropdown-menu-label" data-inset={inset || undefined} className={mergeClassName(`${optionGroupLabelClasses} data-inset:pl-bakin-7`, className)} {...props} />
}

export function DropdownMenuItem({ className, inset, variant = 'default', ...props }: DropdownMenuItemProps) {
  const semanticVariant = variant === 'destructive' ? 'danger' : variant
  return (
    <MenuPrimitive.Item
      {...props}
      data-slot="dropdown-menu-item"
      data-inset={inset || undefined}
      data-variant={semanticVariant}
      className={mergeClassName(`${optionItemClasses} group/dropdown-menu-item data-inset:pl-bakin-7 data-[variant=danger]:text-bakin-signal-danger data-[variant=danger]:data-highlighted:bg-bakin-signal-danger/10`, className)}
    />
  )
}

export function DropdownMenuSub(props: DropdownMenuSubProps) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

export function DropdownMenuSubTrigger({ className, inset, children, ...props }: DropdownMenuSubTriggerProps) {
  return (
    <MenuPrimitive.SubmenuTrigger
      {...props}
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset || undefined}
      className={mergeClassName(`${optionItemClasses} data-inset:pl-bakin-7 data-popup-open:bg-bakin-border-subtle/35`, className)}
    >
      {children}
      <svg aria-hidden="true" viewBox="0 0 16 16" className="ml-auto size-bakin-4 fill-none stroke-current stroke-[1.75]">
        <path d="m6 3 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </MenuPrimitive.SubmenuTrigger>
  )
}

export function DropdownMenuSubContent({ align = 'start', alignOffset = -4, side = 'right', sideOffset = 4, ...props }: DropdownMenuSubContentProps) {
  return <DropdownMenuContent data-slot="dropdown-menu-sub-content" align={align} alignOffset={alignOffset} side={side} sideOffset={sideOffset} {...props} />
}

function ItemIndicator() {
  return (
    <span className="pointer-events-none absolute right-bakin-2 grid size-bakin-4 place-items-center text-bakin-action-primary-background">
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4 fill-none stroke-current stroke-[2.25]">
        <path d="m3.25 8.25 3 3 6.5-7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

export function DropdownMenuCheckboxItem({ className, children, checked, inset, ...props }: DropdownMenuCheckboxItemProps) {
  return (
    <MenuPrimitive.CheckboxItem {...props} checked={checked} data-slot="dropdown-menu-checkbox-item" data-inset={inset || undefined} className={mergeClassName(`${optionItemClasses} data-inset:pl-bakin-7`, className)}>
      {children}
      <MenuPrimitive.CheckboxItemIndicator><ItemIndicator /></MenuPrimitive.CheckboxItemIndicator>
    </MenuPrimitive.CheckboxItem>
  )
}

export function DropdownMenuRadioGroup(props: DropdownMenuRadioGroupProps) {
  return <MenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />
}

export function DropdownMenuRadioItem({ className, children, inset, ...props }: DropdownMenuRadioItemProps) {
  return (
    <MenuPrimitive.RadioItem {...props} data-slot="dropdown-menu-radio-item" data-inset={inset || undefined} className={mergeClassName(`${optionItemClasses} data-inset:pl-bakin-7`, className)}>
      {children}
      <MenuPrimitive.RadioItemIndicator><ItemIndicator /></MenuPrimitive.RadioItemIndicator>
    </MenuPrimitive.RadioItem>
  )
}

export function DropdownMenuSeparator({ className, ...props }: DropdownMenuSeparatorProps) {
  return <MenuPrimitive.Separator data-slot="dropdown-menu-separator" className={mergeClassName(optionSeparatorClasses, className)} {...props} />
}

export function DropdownMenuShortcut({ className, 'aria-hidden': ariaHidden = true, ...props }: DropdownMenuShortcutProps) {
  return <span data-slot="dropdown-menu-shortcut" aria-hidden={ariaHidden} className={cn('ml-auto pl-bakin-4 font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)] tracking-wide text-bakin-text-muted', className)} {...props} />
}
