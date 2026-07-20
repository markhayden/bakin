'use client'

import { Field as FieldPrimitive } from '@base-ui/react/field'
import type { ReactNode } from 'react'

import { inputClasses } from '../primitives/input'
import { mergeClassName } from '../utils'

export type FieldOrientation = 'vertical' | 'horizontal'

export type FieldProps = Omit<FieldPrimitive.Root.Props, 'className'> & {
  className?: FieldPrimitive.Root.Props['className']
  orientation?: FieldOrientation
}

const fieldClasses = [
  'group/field grid min-w-0 gap-bakin-2 font-bakin-typography-family-ui',
  'data-[orientation=horizontal]:grid-cols-[auto_minmax(0,1fr)] data-[orientation=horizontal]:items-start',
  'data-[orientation=horizontal]:[&_[data-slot=checkbox]]:col-start-1 data-[orientation=horizontal]:[&_[data-slot=checkbox]]:row-start-1',
  'data-[orientation=horizontal]:[&_[data-slot=switch]]:col-start-1 data-[orientation=horizontal]:[&_[data-slot=switch]]:row-start-1',
  'data-[orientation=horizontal]:[&_[data-slot=field-label]]:col-start-2 data-[orientation=horizontal]:[&_[data-slot=field-label]]:row-start-1',
  'data-[orientation=horizontal]:[&_[data-slot=field-description]]:col-start-2',
  'data-[orientation=horizontal]:[&_[data-slot=field-error]]:col-start-2',
].join(' ')

export function Field({ className, orientation = 'vertical', ...props }: FieldProps) {
  return (
    <FieldPrimitive.Root
      data-slot="field"
      data-orientation={orientation}
      className={mergeClassName(fieldClasses, className)}
      {...props}
    />
  )
}

export type FieldRequirement = 'required' | 'optional'
export type FieldLabelProps = Omit<FieldPrimitive.Label.Props, 'children' | 'className'> & {
  children?: ReactNode
  className?: FieldPrimitive.Label.Props['className']
  requirement?: FieldRequirement
}

const fieldLabelClasses = [
  'inline-flex min-w-0 items-baseline gap-bakin-2 font-bakin-typography-family-ui',
  'text-[length:var(--bakin-typography-size-body)] font-bakin-typography-weight-semibold leading-snug text-bakin-text-primary',
  'select-none data-disabled:pointer-events-none data-disabled:opacity-[var(--bakin-state-opacity-disabled)]',
].join(' ')

export function FieldLabel({ children, className, requirement, ...props }: FieldLabelProps) {
  return (
    <FieldPrimitive.Label
      data-slot="field-label"
      className={mergeClassName(fieldLabelClasses, className)}
      {...props}
    >
      <span className="min-w-0">{children}</span>
      {requirement ? (
        <span
          aria-hidden="true"
          data-slot="field-requirement"
          data-requirement={requirement}
          className="shrink-0 text-[length:var(--bakin-typography-size-meta)] font-bakin-typography-weight-regular text-bakin-text-muted"
        >
          {requirement === 'required' ? 'Required' : 'Optional'}
        </span>
      ) : null}
    </FieldPrimitive.Label>
  )
}

export type FieldDescriptionProps = FieldPrimitive.Description.Props

export function FieldDescription({ className, ...props }: FieldDescriptionProps) {
  return (
    <FieldPrimitive.Description
      data-slot="field-description"
      className={mergeClassName(
        'text-[length:var(--bakin-typography-size-meta)] leading-relaxed text-bakin-text-muted',
        className,
      )}
      {...props}
    />
  )
}

export type FieldErrorProps = FieldPrimitive.Error.Props

export function FieldError({ className, role = 'alert', ...props }: FieldErrorProps) {
  return (
    <FieldPrimitive.Error
      data-slot="field-error"
      role={role}
      className={mergeClassName(
        'border-l-2 border-bakin-signal-danger pl-bakin-2 text-[length:var(--bakin-typography-size-meta)] leading-relaxed text-bakin-signal-danger',
        className,
      )}
      {...props}
    />
  )
}

export type FieldControlProps = FieldPrimitive.Control.Props

/**
 * A styled input by default. Pass `render={<Textarea />}` to associate native
 * controls that do not participate in Base UI's field context themselves.
 */
export function FieldControl({ className, render, ...props }: FieldControlProps) {
  return (
    <FieldPrimitive.Control
      data-field-control=""
      render={render}
      className={mergeClassName(render == null ? inputClasses : '', className)}
      {...props}
    />
  )
}
