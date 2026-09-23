'use client'

import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import { createContext, useContext } from 'react'
import { cn, mergeClassName } from '../utils'
import { controlGroupFocus, controlStyles, type ControlSize, type ControlVariant } from './control-styles'
import { inputClasses } from './input'
import { optionGroupClasses, optionGroupLabelClasses, optionItemClasses, optionListClasses, optionPopupClasses, anchoredPositionerClasses } from './option-list'
import { PluginPortalBoundary } from './portal-ownership'

export type ComboboxProps<Value, Multiple extends boolean | undefined = false> = ComboboxPrimitive.Root.Props<Value, Multiple>
export const Combobox = ComboboxPrimitive.Root
export type ComboboxValueProps = ComboboxPrimitive.Value.Props
export const ComboboxValue = ComboboxPrimitive.Value

const Appearance = createContext<ControlSize>('md')
export type ComboboxControlProps = ComboboxPrimitive.InputGroup.Props & { size?: ControlSize; variant?: ControlVariant; width?: 'full' | 'auto' }
const minimumHeight: Record<ControlSize, string> = {
  sm: 'min-h-bakin-8',
  md: 'min-h-[var(--bakin-layout-size-control)]',
  lg: 'min-h-[calc(var(--bakin-layout-size-control)+var(--bakin-layout-space-2))]',
}

export function ComboboxControl({ size = 'md', variant = 'outlined', width = 'full', className, ...props }: ComboboxControlProps) {
  return <Appearance value={size}><ComboboxPrimitive.InputGroup data-slot="combobox-control" data-size={size} data-variant={variant} data-width={width}
    className={mergeClassName(cn(controlStyles({ size: null, variant }), minimumHeight[size],
      'group/combobox flex max-w-full self-start items-center gap-bakin-1 p-0', width === 'full' ? 'w-full' : 'w-fit',
      controlGroupFocus,
      'data-invalid:border-bakin-signal-danger data-disabled:opacity-[var(--bakin-state-opacity-disabled)]',
      'data-readonly:[&_[data-slot=combobox-clear]]:hidden data-readonly:[&_[data-slot=combobox-chip-remove]]:hidden',
    ), className)} {...props} /></Appearance>
}

export type ComboboxInputProps = Omit<ComboboxPrimitive.Input.Props, 'size'> & { htmlSize?: number }
export function ComboboxInput({ className, htmlSize, ...props }: ComboboxInputProps) {
  const size = useContext(Appearance)
  return <ComboboxPrimitive.Input data-slot="combobox-input" size={htmlSize}
    className={mergeClassName(cn(controlStyles({ size }), inputClasses,
      'w-0 min-w-bakin-8 flex-1 border-0 bg-transparent shadow-none focus-visible:outline-none disabled:opacity-100',
    ), className)} {...props} />
}

const actionClasses = 'grid size-bakin-6 shrink-0 place-items-center rounded-bakin-control text-bakin-text-muted hover:bg-bakin-surface-elevated focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring disabled:cursor-not-allowed [&_svg]:size-bakin-4'
function Chevron() { return <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="m4 6 4 4 4-4" /></svg> }
function Close() { return <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="m4 4 8 8m0-8-8 8" /></svg> }

export type ComboboxTriggerProps = ComboboxPrimitive.Trigger.Props
export function ComboboxTrigger({ className, children = <Chevron />, ...props }: ComboboxTriggerProps) {
  return <ComboboxPrimitive.Trigger data-slot="combobox-trigger" aria-label="Show options" className={mergeClassName(cn(actionClasses, 'mr-bakin-1'), className)} {...props}>{children}</ComboboxPrimitive.Trigger>
}
export type ComboboxClearProps = ComboboxPrimitive.Clear.Props
export function ComboboxClear({ className, children = <Close />, ...props }: ComboboxClearProps) {
  return <ComboboxPrimitive.Clear data-slot="combobox-clear" aria-label="Clear selection" tabIndex={0} className={mergeClassName(cn(actionClasses, 'mr-bakin-1'), className)} {...props}>{children}</ComboboxPrimitive.Clear>
}

export type ComboboxContentProps = ComboboxPrimitive.Popup.Props & Pick<ComboboxPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>
export function ComboboxContent({ className, side = 'bottom', sideOffset = 4, align = 'start', alignOffset = 0, ...props }: ComboboxContentProps) {
  return <ComboboxPrimitive.Portal><PluginPortalBoundary>
    <ComboboxPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} alignOffset={alignOffset} className={anchoredPositionerClasses}>
      <ComboboxPrimitive.Popup data-slot="combobox-content" className={mergeClassName(optionPopupClasses, className)} {...props} />
    </ComboboxPrimitive.Positioner>
  </PluginPortalBoundary></ComboboxPrimitive.Portal>
}
export type ComboboxListProps = ComboboxPrimitive.List.Props
export function ComboboxList({ className, ...props }: ComboboxListProps) {
  return <ComboboxPrimitive.List data-slot="combobox-list" className={mergeClassName(optionListClasses, className)} {...props} />
}
export type ComboboxItemProps = ComboboxPrimitive.Item.Props
export function ComboboxItem({ className, children, ...props }: ComboboxItemProps) {
  return <ComboboxPrimitive.Item data-slot="combobox-item" className={mergeClassName(optionItemClasses, className)} {...props}>
    <span className="min-w-0 flex-1 whitespace-normal break-words">{children}</span>
    <ComboboxPrimitive.ItemIndicator className="pointer-events-none absolute right-bakin-2 grid size-bakin-4 place-items-center text-bakin-action-primary-background">
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4 fill-none stroke-current" strokeWidth="2"><path d="m3 8 3 3 7-7" /></svg>
    </ComboboxPrimitive.ItemIndicator>
  </ComboboxPrimitive.Item>
}
export type ComboboxGroupProps = ComboboxPrimitive.Group.Props
export function ComboboxGroup({ className, ...props }: ComboboxGroupProps) {
  return <ComboboxPrimitive.Group data-slot="combobox-group" className={mergeClassName(optionGroupClasses, className)} {...props} />
}
export type ComboboxLabelProps = ComboboxPrimitive.GroupLabel.Props
export function ComboboxLabel({ className, ...props }: ComboboxLabelProps) {
  return <ComboboxPrimitive.GroupLabel data-slot="combobox-label" className={mergeClassName(optionGroupLabelClasses, className)} {...props} />
}
export type ComboboxEmptyProps = ComboboxPrimitive.Empty.Props
export function ComboboxEmpty({ className, ...props }: ComboboxEmptyProps) {
  return <ComboboxPrimitive.Empty data-slot="combobox-empty" className={mergeClassName('px-bakin-3 py-bakin-2 text-bakin-text-muted empty:hidden', className)} {...props} />
}
export type ComboboxStatusProps = ComboboxPrimitive.Status.Props
export function ComboboxStatus({ className, ...props }: ComboboxStatusProps) {
  return <ComboboxPrimitive.Status data-slot="combobox-status" className={mergeClassName('px-bakin-3 text-bakin-text-muted', className)} {...props} />
}
export type ComboboxChipsProps = ComboboxPrimitive.Chips.Props
export function ComboboxChips({ className, ...props }: ComboboxChipsProps) {
  return <ComboboxPrimitive.Chips data-slot="combobox-chips" className={mergeClassName('flex min-w-0 flex-1 flex-wrap items-center gap-bakin-1 px-bakin-1 py-[calc(var(--bakin-layout-space-1)/2)]', className)} {...props} />
}
export type ComboboxChipProps = ComboboxPrimitive.Chip.Props
export function ComboboxChip({ className, ...props }: ComboboxChipProps) {
  return <ComboboxPrimitive.Chip data-slot="combobox-chip" className={mergeClassName('flex min-h-bakin-6 min-w-0 max-w-full items-center gap-bakin-1 rounded-bakin-control bg-bakin-surface-elevated pl-bakin-2 text-bakin-text-primary break-words outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-bakin-focus-ring', className)} {...props} />
}
export type ComboboxChipRemoveProps = ComboboxPrimitive.ChipRemove.Props
export function ComboboxChipRemove({ className, children = <Close />, ...props }: ComboboxChipRemoveProps) {
  return <ComboboxPrimitive.ChipRemove data-slot="combobox-chip-remove" className={mergeClassName(actionClasses, className)} {...props}>{children}</ComboboxPrimitive.ChipRemove>
}
