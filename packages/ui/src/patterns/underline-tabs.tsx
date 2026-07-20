'use client'

import * as React from 'react'

import { cn } from '../utils'
import { horizontalSelectionIndex, type HorizontalSelectionKey } from './selection-navigation'

export interface UnderlineTab {
  id: string
  label: string
  disabled?: boolean
}

export interface UnderlineTabsProps {
  tabs: readonly UnderlineTab[]
  value: string
  onValueChange: (id: string) => void
  className?: string
  rightSlot?: React.ReactNode
  ariaLabel?: string
  idPrefix?: string
}

/** Page-section tabs with linked-panel semantics and automatic keyboard activation. */
export function UnderlineTabs({
  tabs,
  value,
  onValueChange,
  className,
  rightSlot,
  ariaLabel,
  idPrefix,
}: UnderlineTabsProps) {
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = tabs.findIndex((tab) => tab.id === value && !tab.disabled)
  const fallbackIndex = tabs.findIndex((tab) => !tab.disabled)
  const tabIndex = selectedIndex >= 0 ? selectedIndex : fallbackIndex

  const move = (index: number, key: HorizontalSelectionKey) => {
    const target = horizontalSelectionIndex(tabs.map((tab) => Boolean(tab.disabled)), index, key)
    if (target === undefined) return
    onValueChange(tabs[target]!.id)
    tabRefs.current[target]?.focus()
  }

  return (
    <div
      data-slot="underline-tabs"
      className={cn('flex min-w-0 max-w-full items-end justify-between gap-bakin-3 border-b border-bakin-border-subtle font-bakin-typography-family-ui', className)}
    >
      <div
        role="tablist"
        aria-label={ariaLabel}
        aria-orientation="horizontal"
        className="flex min-w-0 flex-1 items-end gap-bakin-1 overflow-x-auto overscroll-x-contain"
      >
        {tabs.map((tab, index) => {
          const selected = value === tab.id
          return (
            <button
              key={tab.id}
              ref={(element) => { tabRefs.current[index] = element }}
              id={idPrefix ? `${idPrefix}-tab-${tab.id}` : undefined}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={idPrefix ? `${idPrefix}-panel-${tab.id}` : undefined}
              tabIndex={index === tabIndex ? 0 : -1}
              disabled={tab.disabled}
              className={cn(
                'relative inline-flex min-h-[var(--bakin-layout-size-control)] shrink-0 items-center whitespace-nowrap px-bakin-3 py-bakin-2 text-[length:var(--bakin-typography-size-body)] text-bakin-text-muted outline-none transition-colors duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard after:absolute after:inset-x-bakin-2 after:bottom-0 after:h-0.5 after:origin-center after:scale-x-0 after:bg-bakin-signal-accent after:transition-transform hover:text-bakin-text-primary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-bakin-focus-ring disabled:pointer-events-none disabled:opacity-[var(--bakin-state-opacity-disabled)]',
                selected && 'font-bakin-typography-weight-semibold text-bakin-text-primary after:scale-x-100',
              )}
              onClick={() => onValueChange(tab.id)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                move(index, event.key as HorizontalSelectionKey)
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      {rightSlot ? <div data-slot="underline-tabs-actions" className="flex shrink-0 items-center pb-bakin-2">{rightSlot}</div> : null}
    </div>
  )
}
