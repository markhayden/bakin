import { cva } from 'class-variance-authority'

export type ControlSize = 'sm' | 'md' | 'lg'
export type ControlVariant = 'outlined' | 'filled' | 'ghost'

/** Private presentation shared by field shells, never by Form/Field providers. */
export const controlStyles = cva([
  'min-w-0 rounded-bakin-control border font-bakin-typography-family-ui leading-tight text-bakin-text-primary text-[length:var(--bakin-typography-size-body)]',
  'transition-[background-color,border-color,color] duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard outline-none motion-reduce:transition-none',
  'placeholder:text-bakin-text-muted',
  'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring',
  'disabled:cursor-not-allowed disabled:opacity-[var(--bakin-state-opacity-disabled)]',
  'aria-invalid:border-bakin-signal-danger',
], {
  variants: {
    size: {
      sm: 'px-bakin-2 py-bakin-1',
      md: 'px-bakin-3 py-bakin-1',
      lg: 'px-bakin-4 py-bakin-2',
    },
    variant: {
      outlined: 'border-bakin-border-control bg-bakin-canvas-default',
      filled: 'border-bakin-border-control bg-bakin-surface-elevated',
      ghost: 'border-transparent bg-transparent hover:not-disabled:bg-bakin-surface-default focus-visible:bg-bakin-surface-default',
    },
  },
  defaultVariants: { size: 'md', variant: 'outlined' },
})

export const controlHeight: Record<ControlSize, string> = {
  sm: 'h-bakin-8 min-h-[calc(1lh+var(--bakin-layout-space-3))]',
  md: 'h-[var(--bakin-layout-size-control)] min-h-[calc(1lh+var(--bakin-layout-space-3))]',
  lg: 'h-[calc(var(--bakin-layout-size-control)+var(--bakin-layout-space-2))] min-h-[calc(1lh+var(--bakin-layout-space-4)+var(--bakin-layout-space-1))]',
}

/** Group focus follows the editable control; addon buttons keep their own ring. */
export const controlGroupFocus = 'has-[:is(input,textarea):focus-visible]:outline-solid has-[:is(input,textarea):focus-visible]:outline-2 has-[:is(input,textarea):focus-visible]:outline-offset-2 has-[:is(input,textarea):focus-visible]:outline-bakin-focus-ring'
