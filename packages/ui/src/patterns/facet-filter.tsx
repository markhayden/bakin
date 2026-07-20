'use client'

import * as React from 'react'

import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '../primitives/command'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover'
import { cn } from '../utils'

export interface FacetOption {
  value: string
  label: string
  icon?: React.ReactNode
  disabled?: boolean
}

export interface FacetFilterProps {
  label: string
  options: readonly FacetOption[]
  selected: readonly string[]
  onChange: (selected: string[]) => void
  /** Show search when the option count exceeds this value. */
  searchThreshold?: number
  counts?: Readonly<Record<string, number>>
  searchPlaceholder?: string
  emptyLabel?: string
  clearLabel?: string
  className?: string
}

function CaretIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 fill-none stroke-current stroke-[1.75] opacity-60">
      <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function RemoveIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 fill-none stroke-current stroke-[1.75] opacity-70">
      <path d="m4 4 8 8m0-8-8 8" strokeLinecap="round" />
    </svg>
  )
}

/** Searchable multi-select filter. The consumer owns selected values and URL state. */
export function FacetFilter({
  label,
  options,
  selected,
  onChange,
  searchThreshold = 6,
  counts,
  searchPlaceholder = `Search ${label}`,
  emptyLabel = 'No matching options',
  clearLabel = `Clear ${label} filters`,
  className,
}: FacetFilterProps) {
  const [open, setOpen] = React.useState(false)
  const selectedSet = React.useMemo(() => new Set(selected), [selected])
  const selectedOptions = options.filter((option) => selectedSet.has(option.value))

  const toggle = (value: string) => {
    onChange(selectedSet.has(value)
      ? selected.filter((candidate) => candidate !== value)
      : [...selected, value])
  }

  return (
    <div
      data-facet-filter=""
      className={cn('flex min-w-0 max-w-full flex-wrap items-center gap-bakin-2 font-bakin-typography-family-ui', className)}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={(
            <Button
              variant={selected.length > 0 ? 'secondary' : 'outline'}
              size="sm"
              aria-label={`${label}, ${selected.length} selected`}
              className="max-w-full"
            />
          )}
        >
          <span className="truncate">{label}</span>
          {selected.length > 0 ? (
            <Badge tone="neutral" variant="solid" className="min-w-bakin-6 px-bakin-1 font-bakin-typography-family-mono">
              {selected.length}
            </Badge>
          ) : null}
          <CaretIcon />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label={`Filter by ${label}`}
          className="w-[min(20rem,calc(100vw-var(--bakin-layout-space-8)))] gap-0 p-0"
        >
          <Command label={searchPlaceholder}>
            {options.length > searchThreshold ? (
              <CommandInput placeholder={`${searchPlaceholder}…`} />
            ) : null}
            <CommandList>
              <CommandEmpty>{emptyLabel}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => {
                  const checked = selectedSet.has(option.value)
                  const count = counts?.[option.value]
                  return (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      keywords={[option.label]}
                      checked={checked}
                      disabled={option.disabled}
                      onSelect={() => toggle(option.value)}
                    >
                      {option.icon ? <span aria-hidden="true" className="shrink-0">{option.icon}</span> : null}
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{option.label}</span>
                      {checked ? <span className="sr-only">Selected</span> : null}
                      {count !== undefined ? (
                        <CommandShortcut aria-hidden={false}>{count.toLocaleString()}</CommandShortcut>
                      ) : null}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
            {selected.length > 0 ? (
              <div className="border-t border-bakin-border-subtle p-bakin-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => onChange([])}
                >
                  {clearLabel}
                </Button>
              </div>
            ) : null}
          </Command>
        </PopoverContent>
      </Popover>

      {selectedOptions.map((option) => (
        <Button
          key={option.value}
          variant="secondary"
          size="xs"
          aria-label={`Remove ${option.label} filter`}
          className="max-w-full"
          onClick={() => toggle(option.value)}
        >
          {option.icon ? <span aria-hidden="true" className="shrink-0">{option.icon}</span> : null}
          <span className="truncate">{option.label}</span>
          <RemoveIcon />
        </Button>
      ))}
    </div>
  )
}
