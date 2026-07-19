import type { ComponentProps } from 'react'

import { cn } from '../utils'

export type TextareaProps = ComponentProps<'textarea'>

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        [
          'field-sizing-content min-h-[calc(var(--bakin-layout-size-control)*2.5)] w-full min-w-0 resize-y',
          'rounded-bakin-control border border-bakin-border-subtle bg-bakin-canvas-default px-bakin-3 py-bakin-2',
          'font-bakin-typography-family-ui text-base leading-relaxed text-bakin-text-primary md:text-[length:var(--bakin-typography-size-body)]',
          'transition-[background-color,border-color,color] duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard outline-none',
          'placeholder:text-bakin-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring',
          'disabled:cursor-not-allowed disabled:opacity-[var(--bakin-state-opacity-disabled)]',
          'read-only:bg-bakin-surface-default read-only:text-bakin-text-muted aria-invalid:border-bakin-signal-danger',
          'autofill:bg-bakin-canvas-default autofill:text-bakin-text-primary',
        ].join(' '),
        className,
      )}
      {...props}
    />
  )
}
