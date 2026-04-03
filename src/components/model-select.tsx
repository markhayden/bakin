'use client'

import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel,
} from '@/components/ui/select'
import type { AvailableModel } from '@bakin/models/types'

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
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? '')}>
      <SelectTrigger className={className ?? 'w-full'} size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {defaultLabel && <SelectItem value="__default__">{defaultLabel}</SelectItem>}
        <SelectGroup>
          <SelectLabel>Premium</SelectLabel>
          {models.filter((m) => m.tier === 'premium').map((m) => (
            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Standard</SelectLabel>
          {models.filter((m) => m.tier === 'standard').map((m) => (
            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Budget</SelectLabel>
          {models.filter((m) => m.tier === 'budget').map((m) => (
            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
