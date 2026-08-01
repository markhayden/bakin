'use client'

import { Fieldset as FieldsetPrimitive } from '@base-ui/react/fieldset'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type ComponentProps,
} from 'react'

import { cn, mergeClassName } from '../utils'

type FieldsetDescriptionContextValue = (id: string) => () => void

const FieldsetDescriptionContext = createContext<FieldsetDescriptionContextValue | null>(null)

export type FieldsetProps = FieldsetPrimitive.Root.Props

export function Fieldset({ className, 'aria-describedby': describedByProp, ...props }: FieldsetProps) {
  const [descriptionIds, setDescriptionIds] = useState<string[]>([])
  const registerDescription = useCallback((id: string) => {
    setDescriptionIds((current) => current.includes(id) ? current : [...current, id])
    return () => setDescriptionIds((current) => current.filter((currentId) => currentId !== id))
  }, [])
  const describedBy = [describedByProp, ...descriptionIds].filter(Boolean).join(' ') || undefined

  return (
    <FieldsetDescriptionContext.Provider value={registerDescription}>
      <FieldsetPrimitive.Root
        data-slot="fieldset"
        aria-describedby={describedBy}
        className={mergeClassName(
          'grid min-w-0 gap-bakin-4 border-0 p-0 font-bakin-typography-family-ui',
          className,
        )}
        {...props}
      />
    </FieldsetDescriptionContext.Provider>
  )
}

export type FieldsetLegendProps = FieldsetPrimitive.Legend.Props

export function FieldsetLegend({ className, ...props }: FieldsetLegendProps) {
  return (
    <FieldsetPrimitive.Legend
      data-slot="fieldset-legend"
      className={mergeClassName(
        'text-[length:var(--bakin-typography-size-section-title)] font-bakin-typography-weight-semibold leading-tight text-bakin-text-primary',
        className,
      )}
      {...props}
    />
  )
}

export type FieldsetDescriptionProps = ComponentProps<'p'>

export function FieldsetDescription({ className, id: idProp, ...props }: FieldsetDescriptionProps) {
  const generatedId = useId()
  const id = idProp ?? generatedId
  const registerDescription = useContext(FieldsetDescriptionContext)

  useEffect(() => registerDescription?.(id), [id, registerDescription])

  return (
    <p
      data-slot="fieldset-description"
      id={id}
      className={cn(
        'max-w-prose text-[length:var(--bakin-typography-size-body)] leading-relaxed text-bakin-text-muted',
        className,
      )}
      {...props}
    />
  )
}

export type FieldGroupProps = ComponentProps<'div'>

export function FieldGroup({ className, ...props }: FieldGroupProps) {
  return (
    <div
      data-slot="field-group"
      className={cn('grid min-w-0 gap-bakin-4', className)}
      {...props}
    />
  )
}
