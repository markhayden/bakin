'use client'

import * as React from 'react'

import { cn } from '../utils'
import { horizontalSelectionIndex, type HorizontalSelectionKey } from './selection-navigation'

export interface AgentFilterOption {
  value: string
  label: string
  visual?: React.ReactNode
  disabled?: boolean
}

export interface AgentFilterProps {
  options: readonly AgentFilterOption[]
  value: string
  onValueChange: (value: string) => void
  ariaLabel?: string
  allLabel?: string
  allValue?: string
  showIcon?: boolean
  compact?: boolean
  className?: string
}

function FilterIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4 shrink-0 fill-none stroke-current stroke-[1.6] text-bakin-text-muted">
      <path d="M2.5 3.5h11M4.5 8h7m-5 4.5h3" strokeLinecap="round" />
    </svg>
  )
}

/** Presentation-only single-agent filter. App-aware adapters supply agent metadata and visuals. */
export function AgentFilter({
  options,
  value,
  onValueChange,
  ariaLabel = 'Filter by agent',
  allLabel = 'All agents',
  allValue = 'all',
  showIcon = true,
  compact = false,
  className,
}: AgentFilterProps) {
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([])
  const items = React.useMemo<AgentFilterOption[]>(
    () => [{ value: allValue, label: allLabel }, ...options],
    [allLabel, allValue, options],
  )
  const selectedIndex = items.findIndex((item) => item.value === value && !item.disabled)
  const fallbackIndex = items.findIndex((item) => !item.disabled)
  const tabIndex = selectedIndex >= 0 ? selectedIndex : fallbackIndex

  const move = (index: number, key: HorizontalSelectionKey) => {
    const target = horizontalSelectionIndex(items.map((item) => Boolean(item.disabled)), index, key)
    if (target === undefined) return
    onValueChange(items[target]!.value)
    itemRefs.current[target]?.focus()
  }

  return (
    <div data-agent-filter="" className={cn('flex min-w-0 items-center gap-bakin-2 font-bakin-typography-family-ui', className)}>
      {showIcon ? <FilterIcon /> : null}
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        aria-orientation="horizontal"
        className="flex min-w-0 max-w-full items-center gap-bakin-1 overflow-x-auto overscroll-x-contain rounded-bakin-control border border-bakin-border-subtle/60 bg-bakin-canvas-default p-bakin-1"
      >
        {items.map((item, index) => {
          const selected = item.value === value
          const hideLabel = Boolean(compact && index > 0 && item.visual)
          return (
            <button
              key={item.value}
              ref={(element) => { itemRefs.current[index] = element }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={hideLabel ? item.label : undefined}
              disabled={item.disabled}
              tabIndex={index === tabIndex ? 0 : -1}
              title={hideLabel ? item.label : undefined}
              data-agent-filter-value={item.value}
              className={cn(
                'inline-flex h-bakin-8 shrink-0 items-center justify-center gap-bakin-1 rounded-bakin-control border border-transparent px-bakin-2 text-[length:var(--bakin-typography-size-meta)] font-bakin-typography-weight-semibold text-bakin-text-muted outline-none transition-[background-color,border-color,color,opacity] duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard hover:text-bakin-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring disabled:pointer-events-none disabled:opacity-[var(--bakin-state-opacity-disabled)]',
                selected && 'bg-bakin-border-subtle/35 text-bakin-text-primary',
              )}
              onClick={() => onValueChange(item.value)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                move(index, event.key as HorizontalSelectionKey)
              }}
            >
              {item.visual ? (
                <span
                  aria-hidden="true"
                  data-slot="agent-filter-visual"
                  className="inline-flex size-bakin-6 shrink-0 items-center justify-center leading-none"
                >
                  {item.visual}
                </span>
              ) : null}
              {hideLabel ? <span className="sr-only">{item.label}</span> : <span className="whitespace-nowrap">{item.label}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
