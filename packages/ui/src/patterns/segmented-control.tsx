'use client'

import * as React from 'react'

import { cn } from '../utils'
import { horizontalSelectionIndex, type HorizontalSelectionKey } from '../behaviors/selection-navigation'

export interface SegmentedControlOption<T extends string> {
  value: T
  label: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  hideLabel?: boolean
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedControlOption<T>>
  value: T
  onValueChange: (value: T) => void
  size?: 'sm' | 'md'
  ariaLabel: string
  /** Links each tab to a consumer-owned `${idPrefix}-panel-${value}` panel. */
  idPrefix?: string
  className?: string
}

/** Compact view/mode navigation with automatic horizontal keyboard activation. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  size = 'sm',
  ariaLabel,
  idPrefix,
  className,
}: SegmentedControlProps<T>) {
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled)
  const fallbackIndex = options.findIndex((option) => !option.disabled)
  const tabIndex = selectedIndex >= 0 ? selectedIndex : fallbackIndex

  const move = (index: number, key: HorizontalSelectionKey) => {
    const target = horizontalSelectionIndex(options.map((option) => Boolean(option.disabled)), index, key)
    if (target === undefined) return
    onValueChange(options[target]!.value)
    tabRefs.current[target]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      data-segmented-control=""
      className={cn(
        'inline-block min-w-0 max-w-full self-start justify-self-start overflow-x-auto overscroll-x-contain align-bottom font-bakin-typography-family-ui',
        className,
      )}
    >
      <div
        role="presentation"
        data-slot="segmented-control-list"
        className="flex w-max items-center gap-bakin-1 rounded-bakin-control border border-bakin-border-subtle/60 bg-bakin-canvas-default p-0"
      >
        {options.map((option, index) => {
          const selected = option.value === value
          const Icon = option.icon
          return (
            <button
              key={option.value}
              ref={(element) => { tabRefs.current[index] = element }}
              type="button"
              role="tab"
              id={idPrefix ? `${idPrefix}-tab-${option.value}` : undefined}
              aria-controls={idPrefix ? `${idPrefix}-panel-${option.value}` : undefined}
              aria-selected={selected}
              disabled={option.disabled}
              tabIndex={index === tabIndex ? 0 : -1}
              title={option.hideLabel && typeof option.label === 'string' ? option.label : undefined}
              data-segment={option.value}
              className={cn(
                'inline-flex shrink-0 items-center justify-center gap-bakin-2 whitespace-nowrap rounded-bakin-control border border-transparent font-bakin-typography-weight-semibold text-bakin-text-muted outline-none transition-[background-color,border-color,color] duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard hover:text-bakin-text-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring disabled:pointer-events-none disabled:opacity-[var(--bakin-state-opacity-disabled)]',
                size === 'sm' ? 'h-bakin-8 gap-bakin-1 px-bakin-2 text-[length:var(--bakin-typography-size-meta)]' : 'h-[var(--bakin-layout-size-control)] px-bakin-4 text-[length:var(--bakin-typography-size-body)]',
                selected && 'bg-bakin-border-subtle/35 text-bakin-text-primary',
              )}
              onClick={() => onValueChange(option.value)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                move(index, event.key as HorizontalSelectionKey)
              }}
            >
              {Icon ? <span aria-hidden="true"><Icon className="size-bakin-4" /></span> : null}
              {option.hideLabel ? <span className="sr-only">{option.label}</span> : option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
