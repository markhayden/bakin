import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'

import { mergeClassName } from '../utils'

export type CheckboxProps = CheckboxPrimitive.Root.Props

const checkboxClasses = [
  'group/checkbox relative inline-flex size-bakin-6 shrink-0 cursor-pointer items-center justify-center rounded-bakin-control border border-bakin-border-subtle',
  'bg-bakin-canvas-default text-bakin-action-primary-foreground outline-none select-none',
  'transition-[background-color,border-color,color,opacity] duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard',
  'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring',
  'data-checked:border-bakin-action-primary-background data-checked:bg-bakin-action-primary-background',
  'data-indeterminate:border-bakin-action-primary-background data-indeterminate:bg-bakin-action-primary-background',
  'aria-invalid:border-bakin-signal-danger',
  'data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-[var(--bakin-state-opacity-disabled)]',
  'data-readonly:cursor-default data-readonly:bg-bakin-surface-default',
  'motion-reduce:transition-none',
].join(' ')

export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={mergeClassName(checkboxClasses, className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        keepMounted
        data-slot="checkbox-indicator"
        className="grid size-bakin-4 place-items-center data-unchecked:invisible data-indeterminate:[&_[data-checkbox-check]]:hidden data-indeterminate:[&_[data-checkbox-mixed]]:block"
      >
        <svg data-checkbox-check aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4 fill-none stroke-current stroke-[2.25]">
          <path d="m3.25 8.25 3 3 6.5-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <svg data-checkbox-mixed aria-hidden="true" viewBox="0 0 16 16" className="hidden size-bakin-4 fill-none stroke-current stroke-[2.25]">
          <path d="M3.5 8h9" strokeLinecap="round" />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
