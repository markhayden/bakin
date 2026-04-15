'use client'

import type { ReactNode } from 'react'

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
}

export function UnderlineTabs({ tabs, value, onValueChange, className, rightSlot }: UnderlineTabsProps) {
  return (
    <div className={`flex items-center justify-between gap-3 border-b border-border ${className ?? ''}`}>
      <div className="flex gap-1" role="tablist">
        {tabs.map((t) => {
          const active = value === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={t.disabled}
              onClick={() => onValueChange(t.id)}
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
