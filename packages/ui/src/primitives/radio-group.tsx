import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'

import { mergeClassName } from '../utils'

export type RadioGroupProps = RadioGroupPrimitive.Props
export type RadioProps = RadioPrimitive.Root.Props

/**
 * Single-choice group container. Owns roving focus and the shared value;
 * give it an accessible name (`aria-label` / `aria-labelledby`) and compose
 * `Radio` items inside — one selected value, arrow keys move selection.
 */
export function RadioGroup({ className, ...props }: RadioGroupProps) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={mergeClassName('flex min-w-0 flex-col gap-bakin-2', className)}
      {...props}
    />
  )
}

const radioClasses = [
  'group/radio relative inline-flex size-bakin-6 shrink-0 cursor-pointer items-center justify-center rounded-bakin-pill border border-bakin-border-subtle',
  'bg-bakin-canvas-default text-bakin-action-primary-foreground outline-none select-none',
  'transition-[background-color,border-color,color,opacity] duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard',
  'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring',
  'data-checked:border-bakin-action-primary-background data-checked:bg-bakin-action-primary-background',
  'aria-invalid:border-bakin-signal-danger',
  'data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-[var(--bakin-state-opacity-disabled)]',
  'data-readonly:cursor-default data-readonly:bg-bakin-surface-default',
  'motion-reduce:transition-none',
].join(' ')

/** One choice inside a `RadioGroup`. Renders phrasing content (span-based). */
export function Radio({ className, ...props }: RadioProps) {
  return (
    <RadioPrimitive.Root
      data-slot="radio"
      className={mergeClassName(radioClasses, className)}
      {...props}
    >
      <RadioPrimitive.Indicator
        keepMounted
        data-slot="radio-indicator"
        className="grid size-bakin-4 place-items-center data-unchecked:invisible"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4">
          <circle cx="8" cy="8" r="3.25" className="fill-current" />
        </svg>
      </RadioPrimitive.Indicator>
    </RadioPrimitive.Root>
  )
}
