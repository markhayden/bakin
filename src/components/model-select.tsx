'use client'

import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel,
} from '@/components/ui/select'
import type { AvailableModel } from '@makinbakin/sdk/types'

export type { AvailableModel }

export function ModelSelect({
  value,
  onChange,
  models,
  defaultLabel,
  className,
}: {
  value: string
  onChange: (v: string) => void
  models: AvailableModel[]
  defaultLabel?: string
  className?: string
}) {
  const grouped = models.reduce<Record<string, AvailableModel[]>>((acc, model) => {
    const key = model.provider || 'other'
    if (!acc[key]) acc[key] = []
    acc[key].push(model)
    return acc
  }, {})

  const groupOrder = Object.keys(grouped).sort((a, b) => a.localeCompare(b))

  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? '')}>
      <SelectTrigger className={className ?? 'w-full'} size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {defaultLabel && <SelectItem value="__default__">{defaultLabel}</SelectItem>}
        {groupOrder.map((provider) => (
          <SelectGroup key={provider}>
            <SelectLabel>{provider.replace(/[-_]/g, ' ')}</SelectLabel>
            {grouped[provider].map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
