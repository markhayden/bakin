'use client'

import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface UnderlineTab {
  id: string
  label: string
  disabled?: boolean
}

interface UnderlineTabsProps {
  tabs: readonly UnderlineTab[]
  value: string
  onValueChange: (id: string) => void
  className?: string
  rightSlot?: ReactNode
  /** Accessible name for the tab list. */
  ariaLabel?: string
  /** Links each tab to `${idPrefix}-panel-${tab.id}` and enables arrow-key activation. */
  idPrefix?: string
}

export function UnderlineTabs({
  tabs,
  value,
  onValueChange,
  className,
  rightSlot,
  ariaLabel,
  idPrefix,
}: UnderlineTabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  const activateTab = (index: number) => {
    const tab = tabs[index]
    if (!tab || tab.disabled) return
    onValueChange(tab.id)
    tabRefs.current[index]?.focus()
  }

  const adjacentEnabledTab = (start: number, direction: 1 | -1): number => {
    let index = start
    for (let checked = 0; checked < tabs.length; checked += 1) {
      index = (index + direction + tabs.length) % tabs.length
      if (!tabs[index]?.disabled) return index
    }
    return start
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      activateTab(adjacentEnabledTab(index, event.key === 'ArrowRight' ? 1 : -1))
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const enabled = tabs
        .map((tab, tabIndex) => ({ tab, tabIndex }))
        .filter(({ tab }) => !tab.disabled)
      const target = event.key === 'Home' ? enabled[0] : enabled.at(-1)
      if (target) activateTab(target.tabIndex)
    }
  }

  return (
    <div
      className={`flex items-center justify-between gap-3 border-b border-border ${className ?? ''}`}
      data-slot="underline-tabs"
    >
      <div className="flex gap-1" role="tablist" aria-label={ariaLabel} aria-orientation="horizontal">
        {tabs.map((t, index) => {
          const active = value === t.id
          return (
            <button
              key={t.id}
              ref={(element) => { tabRefs.current[index] = element }}
              id={idPrefix ? `${idPrefix}-tab-${t.id}` : undefined}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={idPrefix ? `${idPrefix}-panel-${t.id}` : undefined}
              tabIndex={idPrefix ? (active ? 0 : -1) : undefined}
              disabled={t.disabled}
              onClick={() => onValueChange(t.id)}
              onKeyDown={idPrefix ? (event) => handleKeyDown(event, index) : undefined}
              className={`px-3 py-2 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                active
                  ? 'text-foreground border-b-2 border-accent font-medium -mb-px'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      {rightSlot && <div className="flex items-center pb-1">{rightSlot}</div>}
    </div>
  )
}
