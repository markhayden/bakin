import * as React from 'react'
import { Select as SelectPrimitive } from '@base-ui/react/select'

import { cn, mergeClassName } from '../utils'
import {
  optionGroupClasses,
  optionGroupLabelClasses,
  optionItemClasses,
  optionListClasses,
  optionPopupClasses,
  optionScrollButtonClasses,
  optionSeparatorClasses,
} from './option-list'
import { controlStyles, controlHeight, type ControlSize, type ControlVariant } from './control-styles'
import { PluginPortalBoundary } from './portal-ownership'

export type SelectProps<Value, Multiple extends boolean | undefined = false> = SelectPrimitive.Root.Props<Value, Multiple>
export type SelectGroupProps = SelectPrimitive.Group.Props
export type SelectValueProps = SelectPrimitive.Value.Props
export type SelectTriggerSize = ControlSize
export type SelectTriggerProps = SelectPrimitive.Trigger.Props & { size?: SelectTriggerSize; variant?: ControlVariant; width?: 'full' | 'auto' }
export type SelectContentProps = SelectPrimitive.Popup.Props & Pick<SelectPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset' | 'alignItemWithTrigger'>
export type SelectLabelProps = SelectPrimitive.GroupLabel.Props
export type SelectItemProps = SelectPrimitive.Item.Props & {
  /**
   * Secondary text under the item's label — the reason a disabled option
   * cannot be chosen. Exposed as the option's accessible DESCRIPTION
   * (`aria-describedby`), never as part of its name.
   */
  description?: React.ReactNode
}
export type SelectSeparatorProps = SelectPrimitive.Separator.Props
export type SelectScrollUpButtonProps = React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>
export type SelectScrollDownButtonProps = React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>

export const Select = SelectPrimitive.Root

export function SelectGroup({ className, ...props }: SelectGroupProps) {
  return <SelectPrimitive.Group data-slot="select-group" className={mergeClassName(optionGroupClasses, className)} {...props} />
}

export function SelectValue({ className, ...props }: SelectValueProps) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={mergeClassName('flex min-w-0 flex-1 items-center gap-bakin-2 overflow-hidden text-left [&>*]:min-w-0', className)}
      {...props}
    />
  )
}

const selectTriggerClasses = [
  'flex max-w-full items-center justify-between gap-bakin-2 select-none',
  'data-placeholder:text-bakin-text-muted data-popup-open:border-bakin-focus-ring',
  'disabled:pointer-events-none',
  '[&_[data-slot=select-value]]:truncate [&_svg]:pointer-events-none [&_svg:not([class*="size-"])]:size-bakin-4 [&_svg]:shrink-0',
].join(' ')

export function SelectTrigger({ className, size = 'md', variant = 'outlined', width = 'auto', children, ...props }: SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      data-variant={variant}
      data-width={width}
      className={mergeClassName(cn(controlStyles({ size, variant }), controlHeight[size], selectTriggerClasses, width === 'full' ? 'w-full' : 'w-fit'), className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <svg aria-hidden="true" viewBox="0 0 16 16" className="text-bakin-text-muted">
            <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
          </svg>
        }
      />
    </SelectPrimitive.Trigger>
  )
}

export function SelectContent({
  className,
  children,
  side = 'bottom',
  sideOffset = 4,
  align = 'center',
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: SelectContentProps) {
  return (
    <SelectPrimitive.Portal>
      <PluginPortalBoundary>
        <SelectPrimitive.Positioner
          side={side}
          sideOffset={sideOffset}
          align={align}
          alignOffset={alignOffset}
          alignItemWithTrigger={alignItemWithTrigger}
          className="isolate z-50"
        >
          <SelectPrimitive.Popup
            data-slot="select-content"
            data-align-trigger={alignItemWithTrigger}
            className={mergeClassName(optionPopupClasses, className)}
            {...props}
          >
            <SelectScrollUpButton />
            <SelectPrimitive.List data-slot="select-list" className={optionListClasses}>{children}</SelectPrimitive.List>
            <SelectScrollDownButton />
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </PluginPortalBoundary>
    </SelectPrimitive.Portal>
  )
}

export function SelectLabel({ className, ...props }: SelectLabelProps) {
  return <SelectPrimitive.GroupLabel data-slot="select-label" className={mergeClassName(optionGroupLabelClasses, className)} {...props} />
}

export function SelectItem({ className, children, description, ...props }: SelectItemProps) {
  const ids = React.useId()
  const labelId = `${ids}-label`
  const descriptionId = `${ids}-description`
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={mergeClassName(cn(optionItemClasses, description ? 'flex-wrap' : undefined), className)}
      // With a description inside the item, the label alone must be the
      // option's NAME; the description is announced as its description.
      aria-labelledby={description ? labelId : undefined}
      aria-describedby={description ? descriptionId : undefined}
      {...props}
    >
      <SelectPrimitive.ItemText id={description ? labelId : undefined} className="min-w-0 flex-1 whitespace-normal break-words">{children}</SelectPrimitive.ItemText>
      {description ? (
        <span
          id={descriptionId}
          data-slot="select-item-description"
          className="basis-full whitespace-normal break-words text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted"
        >
          {description}
        </span>
      ) : null}
      <SelectPrimitive.ItemIndicator
        data-slot="select-item-indicator"
        className="pointer-events-none absolute right-bakin-2 grid size-bakin-4 place-items-center text-bakin-action-primary-background"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4 fill-none stroke-current stroke-[2.25]">
          <path d="m3.25 8.25 3 3 6.5-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

export function SelectSeparator({ className, ...props }: SelectSeparatorProps) {
  return <SelectPrimitive.Separator data-slot="select-separator" className={mergeClassName(optionSeparatorClasses, className)} {...props} />
}

export function SelectScrollUpButton({ className, ...props }: SelectScrollUpButtonProps) {
  return (
    <SelectPrimitive.ScrollUpArrow data-slot="select-scroll-up-button" className={mergeClassName(optionScrollButtonClasses, className)} {...props}>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4">
        <path d="m4 10 4-4 4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
      </svg>
    </SelectPrimitive.ScrollUpArrow>
  )
}

export function SelectScrollDownButton({ className, ...props }: SelectScrollDownButtonProps) {
  return (
    <SelectPrimitive.ScrollDownArrow data-slot="select-scroll-down-button" className={mergeClassName(optionScrollButtonClasses, className)} {...props}>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4">
        <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
      </svg>
    </SelectPrimitive.ScrollDownArrow>
  )
}
