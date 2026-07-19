'use client'

import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible'

import { mergeClassName } from '../utils'

export type CollapsibleProps = CollapsiblePrimitive.Root.Props
export type CollapsibleTriggerProps = CollapsiblePrimitive.Trigger.Props
export type CollapsibleContentProps = CollapsiblePrimitive.Panel.Props

export function Collapsible({ className, ...props }: CollapsibleProps) {
  return (
    <CollapsiblePrimitive.Root
      data-slot="collapsible"
      className={mergeClassName(
        'group/collapsible min-w-0 border-y border-bakin-border-subtle font-bakin-typography-family-ui text-bakin-text-primary',
        className,
      )}
      {...props}
    />
  )
}

export function CollapsibleTrigger({ className, ...props }: CollapsibleTriggerProps) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={mergeClassName(
        [
          'flex min-h-[var(--bakin-layout-size-control)] w-full items-center justify-between gap-bakin-3 py-bakin-2 text-left',
          'font-bakin-typography-weight-semibold outline-none transition-colors duration-[var(--bakin-motion-duration-feedback)]',
          'hover:text-bakin-action-primary-background focus-visible:rounded-bakin-control focus-visible:outline-2',
          'focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring disabled:opacity-[var(--bakin-state-opacity-disabled)]',
        ].join(' '),
        className,
      )}
      {...props}
    />
  )
}

export function CollapsibleContent({ className, ...props }: CollapsibleContentProps) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      className={mergeClassName(
        'min-w-0 [overflow-wrap:anywhere] pb-bakin-4 leading-relaxed text-bakin-text-muted',
        className,
      )}
      {...props}
    />
  )
}
