import { Input as InputPrimitive } from '@base-ui/react/input'

import { mergeClassName } from '../utils'

export type InputProps = InputPrimitive.Props

/** Shared internally by FieldControl when it renders its default input. */
export const inputClasses = [
  'h-[var(--bakin-layout-size-control)] w-full min-w-0 rounded-bakin-control border border-bakin-border-subtle',
  'bg-bakin-canvas-default px-bakin-3 py-bakin-2 font-bakin-typography-family-ui text-base leading-tight text-bakin-text-primary md:text-[length:var(--bakin-typography-size-body)]',
  'transition-[background-color,border-color,color] duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard outline-none',
  'placeholder:text-bakin-text-muted',
  'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring',
  'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-[var(--bakin-state-opacity-disabled)]',
  'read-only:bg-bakin-surface-default read-only:text-bakin-text-muted',
  'aria-invalid:border-bakin-signal-danger',
  'autofill:bg-bakin-canvas-default autofill:text-bakin-text-primary',
  'file:mr-bakin-3 file:inline-flex file:h-bakin-6 file:border-0 file:bg-transparent file:font-bakin-typography-weight-semibold file:text-bakin-text-primary',
].join(' ')

export function Input({ className, type, ...props }: InputProps) {
  return (
    <InputPrimitive
      data-slot="input"
      type={type}
      className={mergeClassName(inputClasses, className)}
      {...props}
    />
  )
}
