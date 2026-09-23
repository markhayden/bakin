import { Input as InputPrimitive } from '@base-ui/react/input'

import { cn, mergeClassName } from '../utils'
import { controlHeight, controlStyles, type ControlSize, type ControlVariant } from './control-styles'

export type InputProps = Omit<InputPrimitive.Props, 'size'> & {
  size?: ControlSize
  variant?: ControlVariant
  htmlSize?: number
}

/** Shared internally by FieldControl when it renders its default input. */
export const inputClasses = [
  'w-full text-base md:text-[length:var(--bakin-typography-size-body)] leading-tight',
  'autofill:bg-bakin-canvas-default autofill:text-bakin-text-primary',
  'file:mr-bakin-3 file:inline-flex file:h-bakin-6 file:border-0 file:bg-transparent file:font-bakin-typography-weight-semibold file:text-bakin-text-primary',
].join(' ')

export function Input({ className, type, size = 'md', variant = 'outlined', htmlSize, ...props }: InputProps) {
  return (
    <InputPrimitive
      data-slot="input"
      type={type}
      size={htmlSize}
      data-size={size}
      data-variant={variant}
      className={mergeClassName(cn(controlStyles({ size, variant }), controlHeight[size], inputClasses), className)}
      {...props}
    />
  )
}
