'use client'

import { useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import { Badge } from '@/components/ui/badge'

export interface FacetOption {
  value: string
  label: string
  icon?: React.ReactNode
}

interface FacetFilterProps {
  label: string
  options: FacetOption[]
  selected: string[]
  onChange: (selected: string[]) => void
  /** Show search input when options exceed this count (default: 6) */
  searchThreshold?: number
  /** Optional aggregation counts from search (value → count) */
  counts?: Record<string, number>
}

export function FacetFilter({ label, options, selected, onChange, searchThreshold = 6, counts }: FacetFilterProps) {
  const [open, setOpen] = useState(false)
  const showSearch = options.length > searchThreshold

  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter(v => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  function clear() {
    onChange([])
  }

  const selectedLabels = options.filter(o => selected.includes(o.value))

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
            selected.length > 0
              ? 'border-accent/50 bg-accent/10 text-foreground'
              : 'border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          {label}
          {selected.length > 0 && (
            <Badge variant="secondary" className="px-1 py-0 text-[10px] font-mono h-4 min-w-[1rem] justify-center">
              {selected.length}
            </Badge>
          )}
          <ChevronDown className="size-3 opacity-50" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-52 p-0">
          <Command>
            {showSearch && <CommandInput placeholder={`Search ${label.toLowerCase()}...`} />}
            <CommandList>
              <CommandEmpty>No results.</CommandEmpty>
              <CommandGroup>
                {options.map(option => {
                  const isSelected = selected.includes(option.value)
                  return (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      keywords={[option.label]}
                      onSelect={() => toggle(option.value)}
                      data-checked={isSelected || undefined}
                    >
                      {option.icon && <span className="shrink-0">{option.icon}</span>}
                      <span className="truncate">{option.label}</span>
                      {counts?.[option.value] !== undefined && (
                        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{counts[option.value]}</span>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
            {selected.length > 0 && (
              <div className="border-t border-border p-1">
                <button
                  onClick={clear}
                  className="w-full text-xs text-muted-foreground hover:text-foreground py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors text-center"
                >
                  Clear filters
                </button>
              </div>
            )}
          </Command>
        </PopoverContent>
      </Popover>

      {/* Selected chips */}
      {selectedLabels.map(opt => (
        <button
          key={opt.value}
          onClick={() => toggle(opt.value)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/10 border border-accent/30 text-xs text-foreground hover:bg-accent/20 transition-colors"
        >
          {opt.icon && <span className="shrink-0">{opt.icon}</span>}
          {opt.label}
          <X className="size-3 opacity-50" />
        </button>
      ))}
    </div>
  )
}
