'use client'

import { useImperativeHandle, useRef, type ComponentProps } from 'react'

import { cn } from '../utils'
import { controlStyles, type ControlSize, type ControlVariant } from './control-styles'
import { useTextareaAutosize } from './use-textarea-autosize'

type TextareaHeight =
  | { autoSize?: false; rows?: number; minRows?: never; maxRows?: never }
  | { autoSize: true; rows?: never; minRows?: number; maxRows?: number }

export type TextareaProps = Omit<ComponentProps<'textarea'>, 'rows'> & TextareaHeight & {
  size?: ControlSize
  variant?: ControlVariant
}

export function Textarea({
  className, size = 'md', variant = 'outlined', autoSize = false,
  rows = 3, minRows = 3, maxRows = 10, ref, onInput, ...props
}: TextareaProps) {
  const control = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => control.current!, [])
  const resize = useTextareaAutosize(control, autoSize, minRows, maxRows)
  if (autoSize && (!Number.isInteger(minRows) || minRows < 1 || !Number.isInteger(maxRows) || maxRows < minRows)) {
    throw new RangeError('Textarea autoSize requires positive integer minRows and maxRows >= minRows')
  }
  return (
    <textarea
      data-slot="textarea"
      {...props}
      ref={control}
      rows={autoSize ? minRows : rows}
      data-size={size}
      data-variant={variant}
      data-auto-size={autoSize || undefined}
      onInput={(event) => { onInput?.(event); resize() }}
      className={cn(
        controlStyles({ size, variant }),
        'w-full text-base leading-relaxed md:text-[length:var(--bakin-typography-size-body)]',
        autoSize ? 'resize-none' : 'resize-y',
        'autofill:bg-bakin-canvas-default autofill:text-bakin-text-primary',
        className,
      )}
    />
  )
}
