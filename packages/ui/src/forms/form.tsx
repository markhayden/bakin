'use client'

import { Form as FormPrimitive } from '@base-ui/react/form'
import { createContext, useContext, type ComponentProps, type ReactNode, type Ref } from 'react'

import { Button, type ButtonProps } from '../primitives/button'
import { cn, mergeClassName } from '../utils'

const FormBusyContext = createContext(false)

export type FormProps<FormValues extends Record<string, unknown> = Record<string, unknown>> =
  Omit<FormPrimitive.Props<FormValues>, 'className'> & {
    busy?: boolean
    className?: FormPrimitive.Props<FormValues>['className']
    ref?: Ref<HTMLFormElement>
  }

export function Form<FormValues extends Record<string, unknown> = Record<string, unknown>>({
  busy = false,
  className,
  'aria-busy': ariaBusyProp,
  ...props
}: FormProps<FormValues>) {
  const ariaBusy = busy || ariaBusyProp === true || ariaBusyProp === 'true'

  return (
    <FormBusyContext.Provider value={busy}>
      <FormPrimitive
        {...props}
        data-slot="form"
        data-busy={busy ? 'true' : 'false'}
        aria-busy={ariaBusy || undefined}
        className={mergeClassName('@container/form grid min-w-0 gap-bakin-6', className)}
      />
    </FormBusyContext.Provider>
  )
}

export type FormActionsAlign = 'start' | 'end' | 'between'
export type FormActionsProps = ComponentProps<'div'> & {
  align?: FormActionsAlign
}

const actionAlignment: Record<FormActionsAlign, string> = {
  start: '@sm/form:justify-start',
  end: '@sm/form:justify-end',
  between: '@sm/form:justify-between',
}

export function FormActions({ align = 'end', className, ...props }: FormActionsProps) {
  return (
    <div
      data-slot="form-actions"
      data-align={align}
      className={cn(
        'flex min-w-0 flex-col gap-bakin-2 border-t border-bakin-border-subtle pt-bakin-4',
        '@sm/form:flex-row @sm/form:items-center [&>[data-slot=button]]:w-full @sm/form:[&>[data-slot=button]]:w-auto',
        actionAlignment[align],
        className,
      )}
      {...props}
    />
  )
}

export type SubmitButtonProps = Omit<ButtonProps, 'type'> & {
  busy?: boolean
  busyLabel?: ReactNode
}

export function SubmitButton({
  busy: busyProp,
  busyLabel = 'Submitting…',
  children,
  disabled,
  ...props
}: SubmitButtonProps) {
  const formBusy = useContext(FormBusyContext)
  const busy = Boolean(busyProp || formBusy)

  return (
    <Button
      {...props}
      type="submit"
      busy={busy}
      // A submit control keeps the real `disabled` attribute while busy so an
      // implicit form submission (Enter in a field) cannot fire twice — the
      // one place the focusable-but-inert busy default is the wrong call.
      focusableWhenDisabled={false}
      disabled={disabled}
    >
      {busy ? busyLabel : children}
    </Button>
  )
}
