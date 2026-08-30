'use client'

import * as React from 'react'

import { cn } from '../utils'
import { verticalSelectionIndex, type VerticalSelectionKey } from '../behaviors/selection-navigation'

export interface NavListItem<T extends string = string> {
  id: T
  label: React.ReactNode
  /** Compact leading identity — icon, avatar, status dot. */
  leading?: React.ReactNode
  /** Trailing metadata — count, badge, short status. */
  meta?: React.ReactNode
  /** Optional secondary line under the label. */
  description?: React.ReactNode
  disabled?: boolean
}

export interface NavListSection<T extends string = string> {
  /** Group heading rendered above the section's items; omit for an unlabeled group. */
  label?: string
  items: ReadonlyArray<NavListItem<T>>
}

export interface NavListProps<T extends string = string> {
  /** Accessible name for the navigator (`<nav aria-label>`). */
  label: string
  /** Flat item list. Provide exactly one of `items` or `sections`. */
  items?: ReadonlyArray<NavListItem<T>>
  /** Grouped items with optional section headings. */
  sections?: ReadonlyArray<NavListSection<T>>
  selectedId: T | null
  onSelect: (id: T) => void
  className?: string
}

const VERTICAL_KEYS = ['ArrowUp', 'ArrowDown', 'Home', 'End'] as const

/**
 * Master-detail selection list: a vertical stack of options where choosing one
 * swaps the adjacent detail surface. State-backed by design — the selection
 * lives in consumer state (`selectedId`/`onSelect`) and is announced with
 * `aria-current="true"` inside a labeled `<nav>`. Route-backed navigators
 * (where each entry is a real URL) should keep using `PluginLink` with
 * `aria-current="page"` via `@makinbakin/sdk/navigation` instead.
 *
 * The pattern owns stack semantics, selection state, disabled handling, and
 * ArrowUp/ArrowDown/Home/End focus movement; consumers own labels, metadata,
 * and what the selection reveals.
 */
export function NavList<T extends string = string>({
  label,
  items,
  sections,
  selectedId,
  onSelect,
  className,
}: NavListProps<T>) {
  const groups = React.useMemo<ReadonlyArray<NavListSection<T>>>(
    () => sections ?? [{ items: items ?? [] }],
    [items, sections],
  )
  const flat = React.useMemo(() => groups.flatMap((section) => section.items), [groups])
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([])

  const moveFocus = (index: number, key: VerticalSelectionKey) => {
    const target = verticalSelectionIndex(
      flat.map((item) => Boolean(item.disabled)),
      index,
      key,
    )
    if (target === undefined) return
    itemRefs.current[target]?.focus()
  }

  let flatIndex = -1

  return (
    <nav
      aria-label={label}
      data-nav-list=""
      className={cn('min-w-0 font-bakin-typography-family-ui', className)}
    >
      {groups.map((section, sectionIndex) => (
        <div
          key={section.label ?? `section-${sectionIndex}`}
          data-slot="nav-list-section"
          className={cn(sectionIndex > 0 && 'mt-5')}
        >
          {section.label ? (
            <div
              data-slot="nav-list-section-label"
              className="px-bakin-3 pb-bakin-2 text-bakin-typography-size-meta font-bakin-typography-weight-semibold uppercase tracking-widest text-bakin-text-muted"
            >
              {section.label}
            </div>
          ) : null}
          <ul className="m-0 grid min-w-0 list-none gap-bakin-1 p-0">
            {section.items.map((item) => {
              flatIndex += 1
              const index = flatIndex
              const selected = item.id === selectedId
              return (
                <li key={item.id} className="min-w-0">
                  <button
                    ref={(element) => { itemRefs.current[index] = element }}
                    type="button"
                    aria-current={selected ? 'true' : undefined}
                    disabled={item.disabled}
                    data-slot="nav-list-item"
                    data-selected={selected ? '' : undefined}
                    className={cn(
                      'flex w-full min-w-0 items-center gap-bakin-2 rounded-bakin-control border border-transparent px-bakin-3 py-bakin-2 text-left text-bakin-typography-size-body outline-none transition-[background-color,color] duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring disabled:pointer-events-none disabled:opacity-[var(--bakin-state-opacity-disabled)]',
                      selected
                        ? 'bg-bakin-border-subtle/35 font-bakin-typography-weight-medium text-bakin-text-primary'
                        : 'text-bakin-text-muted hover:bg-bakin-surface-default hover:text-bakin-text-primary',
                    )}
                    onClick={() => onSelect(item.id)}
                    onKeyDown={(event) => {
                      if (!(VERTICAL_KEYS as readonly string[]).includes(event.key)) return
                      event.preventDefault()
                      moveFocus(index, event.key as VerticalSelectionKey)
                    }}
                  >
                    {item.leading ? (
                      <span data-slot="nav-list-leading" className="shrink-0">
                        {item.leading}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.label}</span>
                      {item.description ? (
                        <span
                          data-slot="nav-list-description"
                          className="mt-bakin-1 line-clamp-2 block text-bakin-typography-size-meta font-bakin-typography-weight-regular leading-snug text-bakin-text-muted"
                        >
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                    {item.meta ? (
                      <span data-slot="nav-list-meta" className="shrink-0">
                        {item.meta}
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
