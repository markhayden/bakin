'use client'

import { cva } from 'class-variance-authority'
import { createContext, useContext, type ComponentProps } from 'react'

import { cn, mergeClassName } from '../utils'
import { Button } from './button'
import type { ButtonProps, ButtonVariant, LegacyButtonVariant } from './button'
import { controlGroupFocus, controlStyles, controlHeight, type ControlSize, type ControlVariant } from './control-styles'
import { Input } from './input'
import type { InputProps } from './input'
import { Textarea } from './textarea'
import type { TextareaProps } from './textarea'

const InputGroupAppearance = createContext<ControlSize>('md')

export type InputGroupProps = ComponentProps<'div'> & { size?: ControlSize; variant?: ControlVariant }

export function InputGroup({ className, size = 'md', variant = 'outlined', ...props }: InputGroupProps) {
  return (
    <InputGroupAppearance value={size}><div
      data-slot="input-group"
      data-size={size}
      data-variant={variant}
      role="group"
      className={cn(
        controlStyles({ size: null, variant }),
        controlHeight[size],
        [
          'group/input-group relative flex w-full items-center p-0',
          'transition-[background-color,border-color,color] duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard outline-none',
          'has-[[data-slot=input-group-control]:disabled]:pointer-events-none has-[[data-slot=input-group-control]:disabled]:opacity-[var(--bakin-state-opacity-disabled)]',
          controlGroupFocus,
          'has-[[data-slot=input-group-control][aria-invalid=true]]:border-bakin-signal-danger',
          'has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col',
          'has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col',
          'has-[>textarea]:h-auto',
          'has-[>[data-align=block-end]]:[&>input]:pt-bakin-3 has-[>[data-align=block-start]]:[&>input]:pb-bakin-3',
          'has-[>[data-align=inline-end]]:[&>input]:pr-bakin-2 has-[>[data-align=inline-start]]:[&>input]:pl-bakin-2',
        ].join(' '),
        className,
      )}
      {...props}
    /></InputGroupAppearance>
  )
}

export type InputGroupAddonAlign = 'inline-start' | 'inline-end' | 'block-start' | 'block-end'

const inputGroupAddonVariants = cva(
  [
    'flex h-auto cursor-text select-none items-center justify-center gap-bakin-2',
    'font-bakin-typography-family-ui text-[length:var(--bakin-typography-size-body)] font-bakin-typography-weight-semibold text-bakin-text-muted',
    '[&>svg:not([class*="size-"])]:size-bakin-4 [&>svg]:shrink-0',
  ],
  {
    variants: {
      align: {
        'inline-start': 'order-first pl-bakin-3 group-data-[size=sm]/input-group:pl-bakin-2 group-data-[size=lg]/input-group:pl-bakin-4',
        'inline-end': 'order-last pr-bakin-3 group-data-[size=sm]/input-group:pr-bakin-2 group-data-[size=lg]/input-group:pr-bakin-4',
        'block-start': 'order-first w-full justify-start px-bakin-3 pt-bakin-3',
        'block-end': 'order-last w-full justify-start px-bakin-3 pb-bakin-3',
      },
    },
    defaultVariants: { align: 'inline-start' },
  },
)

export type InputGroupAddonProps = ComponentProps<'div'> & { align?: InputGroupAddonAlign }

export function InputGroupAddon({
  className,
  align = 'inline-start',
  onClick,
  ...props
}: InputGroupAddonProps) {
  return (
    <div
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || (event.target as HTMLElement).closest('button, a, input, textarea, select')) return
        event.currentTarget.parentElement?.querySelector<HTMLElement>('input, textarea')?.focus()
      }}
      {...props}
    />
  )
}

export type InputGroupButtonSize = 'xs' | 'sm' | 'icon-xs' | 'icon-sm'

const inputGroupButtonVariants = cva('shadow-none', {
  variants: {
    size: {
      xs: 'h-bakin-6 gap-bakin-1 px-bakin-2',
      sm: 'h-bakin-8 gap-bakin-2 px-bakin-3',
      'icon-xs': 'size-bakin-6 p-0',
      'icon-sm': 'size-bakin-8 p-0',
    },
  },
  defaultVariants: { size: 'xs' },
})

export type InputGroupButtonProps = Omit<ButtonProps, 'size' | 'type' | 'variant'> & {
  size?: InputGroupButtonSize
  type?: 'button' | 'submit' | 'reset'
  variant?: ButtonVariant | LegacyButtonVariant
}

export function InputGroupButton({
  className,
  type = 'button',
  variant = 'ghost',
  size = 'xs',
  ...props
}: InputGroupButtonProps) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      size={size}
      className={mergeClassName(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  )
}

export type InputGroupTextProps = ComponentProps<'span'>

export function InputGroupText({ className, ...props }: InputGroupTextProps) {
  return (
    <span
      data-slot="input-group-text"
      className={cn(
        'flex min-w-0 items-center gap-bakin-2 text-bakin-text-muted [&_svg:not([class*="size-"])]:size-bakin-4',
        className,
      )}
      {...props}
    />
  )
}

export type InputGroupInputProps = Omit<InputProps, 'size' | 'variant'>

export function InputGroupInput({ className, ...props }: InputGroupInputProps) {
  const size = useContext(InputGroupAppearance)
  return (
    <Input
      data-slot="input-group-control"
      className={mergeClassName(
        'h-full min-h-0 flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:outline-none disabled:bg-transparent disabled:opacity-100 read-only:bg-transparent aria-invalid:border-0',
        className,
      )}
      {...props}
      size={size}
      variant="outlined"
    />
  )
}

type WithoutAppearance<T> = T extends unknown ? Omit<T, 'size' | 'variant'> : never
export type InputGroupTextareaProps = WithoutAppearance<TextareaProps>

export function InputGroupTextarea({ className, ...props }: InputGroupTextareaProps) {
  const size = useContext(InputGroupAppearance)
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        'flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:outline-none disabled:bg-transparent disabled:opacity-100 read-only:bg-transparent aria-invalid:border-0',
        className,
      )}
      {...props}
      size={size}
      variant="outlined"
    />
  )
}
