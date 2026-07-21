'use client'

import { ModelSelect as ModelSelectPresentation } from '@makinbakin/sdk/patterns'
import type { AvailableModel } from '@makinbakin/sdk/types'

export type { AvailableModel }

/** Compatibility adapter preserving the established model-catalog option type. */
export function ModelSelect({
  value,
  onChange,
  models,
  defaultLabel,
  className,
  id,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  models: AvailableModel[]
  defaultLabel?: string
  className?: string
  id?: string
  ariaLabel?: string
}) {
  return (
    <ModelSelectPresentation
      id={id}
      ariaLabel={ariaLabel ?? (id ? undefined : 'Select model')}
      value={value}
      onValueChange={onChange}
      models={models}
      defaultLabel={defaultLabel}
      className={className}
    />
  )
}
