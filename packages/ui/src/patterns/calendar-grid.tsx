'use client'

import * as React from 'react'

import { cn } from '../utils'

export type CalendarGridView = 'month' | 'week' | 'day'

export interface CalendarGridItem {
  key: string
  /** Instant the item occupies. Point items set `date`; range items set `start`. */
  date?: Date | string
  /** Start instant for range-shaped items — placement uses `start` when present. */
  start?: Date | string
  /** Reserved for future multi-day spans; today's placement ignores it. */
  end?: Date | string
  /** Week and day views: render in the per-day all-day lane instead of an hour cell. */
  allDay?: boolean
}

export interface CalendarGridProps<T extends CalendarGridItem> {
  view: CalendarGridView
  /** Any date inside the visible month, week (Sunday-start), or day. */
  date: Date
  items: ReadonlyArray<T>
  /** Consumer-owned item content — chips, cards, popovers. Rendered inside the item's cell. */
  renderItem: (item: T) => React.ReactNode
  /** Accessible name for the calendar surface. */
  label: string
  /**
   * The instant that drives today/current-hour marking and past-day dimming.
   * Defaults to render time; pass a fixed instant for deterministic output.
   */
  now?: Date
  /** Month view: items shown per day before the overflow disclosure. */
  maxVisibleItems?: number
  /** Week view: extra consumer content under a day's header (summaries, counts). */
  renderDayHeader?: (date: Date) => React.ReactNode
  className?: string
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const HOURS = Array.from({ length: 24 }, (_, index) => index)
const NAVIGATION_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'] as const
const WEEK_ROW_TEMPLATE = '[grid-template-columns:3.5rem_repeat(7,minmax(15.625rem,1fr))]'

function toDate(value: Date | string | undefined): Date | null {
  if (value === undefined) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** The instant an item is placed by — `start` wins over `date`. */
function itemInstant(item: CalendarGridItem): Date | null {
  return toDate(item.start) ?? toDate(item.date)
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function startOfLocalDay(date: Date): Date {
  const day = new Date(date)
  day.setHours(0, 0, 0, 0)
  return day
}

/** Leading/trailing blanks pad the month into whole Sunday-start weeks. */
function monthCells(year: number, month: number): Array<Date | null> {
  const days: Date[] = []
  const cursor = new Date(year, month, 1)
  while (cursor.getMonth() === month) {
    days.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  const cells: Array<Date | null> = []
  for (let blank = 0; blank < days[0]!.getDay(); blank += 1) cells.push(null)
  cells.push(...days)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function weekDatesFor(anchor: Date): Date[] {
  const start = startOfLocalDay(anchor)
  start.setDate(start.getDate() - start.getDay())
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start)
    day.setDate(day.getDate() + index)
    return day
  })
}

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM'
  if (hour < 12) return `${hour} AM`
  if (hour === 12) return '12 PM'
  return `${hour - 12} PM`
}

function dayLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function countLabel(count: number): string {
  return count === 1 ? '1 item' : `${count} items`
}

function cellLabel(parts: string[], count: number): string {
  return [...parts, count > 0 ? countLabel(count) : 'no items'].join(', ')
}

/** Enter/Space hands focus from a cell to the first interactive item inside it. */
function focusFirstInteractive(cell: HTMLElement): void {
  cell
    .querySelector<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ?.focus()
}

type CellCoordinate = readonly [row: number, column: number]

interface RovingGrid {
  cellProps: (
    row: number,
    column: number,
    ariaLabel: string,
  ) => React.HTMLAttributes<HTMLDivElement> & {
    ref: React.RefCallback<HTMLDivElement>
    tabIndex: number
  }
}

/**
 * Roving-tabindex keyboard navigation over grid cells: one tab stop for the
 * whole grid, arrows move by cell, Home/End jump within the row, Enter/Space
 * enters the cell's first interactive item. Item widgets keep their own keys.
 */
function useRovingGrid(
  rowCount: number,
  columnCount: number,
  isNavigable: (row: number, column: number) => boolean,
  defaultCell: CellCoordinate | null,
): RovingGrid {
  const [active, setActive] = React.useState<CellCoordinate | null>(null)
  const refs = React.useRef(new Map<string, HTMLDivElement>())
  const current = active && active[0] < rowCount && isNavigable(active[0], active[1])
    ? active
    : defaultCell

  const move = (row: number, column: number, key: string): void => {
    let target: CellCoordinate | null = null
    if (key === 'ArrowLeft') target = [row, column - 1]
    else if (key === 'ArrowRight') target = [row, column + 1]
    else if (key === 'ArrowUp') target = [row - 1, column]
    else if (key === 'ArrowDown') target = [row + 1, column]
    else if (key === 'Home') {
      for (let candidate = 0; candidate < columnCount; candidate += 1) {
        if (isNavigable(row, candidate)) { target = [row, candidate]; break }
      }
    } else if (key === 'End') {
      for (let candidate = columnCount - 1; candidate >= 0; candidate -= 1) {
        if (isNavigable(row, candidate)) { target = [row, candidate]; break }
      }
    }
    if (!target) return
    const [nextRow, nextColumn] = target
    if (nextRow < 0 || nextRow >= rowCount || nextColumn < 0 || nextColumn >= columnCount) return
    if (!isNavigable(nextRow, nextColumn)) return
    setActive([nextRow, nextColumn])
    refs.current.get(`${nextRow}-${nextColumn}`)?.focus()
  }

  const cellProps: RovingGrid['cellProps'] = (row, column, ariaLabel) => ({
    role: 'gridcell',
    'aria-label': ariaLabel,
    tabIndex: current?.[0] === row && current?.[1] === column ? 0 : -1,
    ref: (element: HTMLDivElement | null) => {
      if (element) refs.current.set(`${row}-${column}`, element)
      else refs.current.delete(`${row}-${column}`)
    },
    onFocus: () => setActive([row, column]),
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return
      if ((NAVIGATION_KEYS as readonly string[]).includes(event.key)) {
        event.preventDefault()
        move(row, column, event.key)
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        focusFirstInteractive(event.currentTarget)
      }
    },
  })

  return { cellProps }
}

function renderItems<T extends CalendarGridItem>(
  items: ReadonlyArray<T>,
  renderItem: (item: T) => React.ReactNode,
): React.ReactNode {
  return items.map((item) => <React.Fragment key={item.key}>{renderItem(item)}</React.Fragment>)
}

/**
 * The shared calendar STRUCTURE for month (7-column day grid), week
 * (hour-by-day grid with an all-day lane), and day (hour-row agenda) views.
 *
 * The kit owns grid geometry, day/hour headers, today and current-hour
 * marking, past-day dimming, keyboard cell navigation, and the month
 * overflow disclosure. Consumers own everything rendered for an item —
 * chips, cards, popovers, drag behavior — plus range navigation controls
 * (previous/next/today) and item ordering, which is preserved per cell.
 */
export function CalendarGrid<T extends CalendarGridItem>({
  view,
  date,
  items,
  renderItem,
  label,
  now,
  maxVisibleItems = 3,
  renderDayHeader,
  className,
}: CalendarGridProps<T>) {
  const currentInstant = now ?? new Date()
  const todayKey = localDayKey(currentInstant)
  const todayStart = startOfLocalDay(currentInstant).getTime()

  const [expandedDays, setExpandedDays] = React.useState<ReadonlySet<string>>(new Set())
  const toggleDay = (dayKey: string): void => {
    setExpandedDays((previous) => {
      const next = new Set(previous)
      if (next.has(dayKey)) next.delete(dayKey)
      else next.add(dayKey)
      return next
    })
  }

  const weeks = React.useMemo(() => {
    if (view !== 'month') return []
    const cells = monthCells(date.getFullYear(), date.getMonth())
    const rows: Array<Array<Date | null>> = []
    for (let index = 0; index < cells.length; index += 7) rows.push(cells.slice(index, index + 7))
    return rows
  }, [view, date])

  const weekDates = React.useMemo(
    () => (view === 'week' ? weekDatesFor(date) : []),
    [view, date],
  )

  // Per-cell item placement — input order is preserved inside every cell.
  const placement = React.useMemo(() => {
    const byDay = new Map<string, T[]>()
    const byDayHour = new Map<string, T[]>()
    const allDayByDay = new Map<string, T[]>()
    for (const item of items) {
      const instant = itemInstant(item)
      if (!instant) continue
      const dayKey = localDayKey(instant)
      if (item.allDay) {
        allDayByDay.set(dayKey, [...(allDayByDay.get(dayKey) ?? []), item])
        continue
      }
      byDay.set(dayKey, [...(byDay.get(dayKey) ?? []), item])
      const hourKey = `${dayKey}:${instant.getHours()}`
      byDayHour.set(hourKey, [...(byDayHour.get(hourKey) ?? []), item])
    }
    return { byDay, byDayHour, allDayByDay }
  }, [items])

  /** Month view treats all-day items like any other member of the day stack. */
  const monthItemsFor = (day: Date): T[] => {
    const dayKey = localDayKey(day)
    return [...(placement.byDay.get(dayKey) ?? []), ...(placement.allDayByDay.get(dayKey) ?? [])]
  }

  const hasAllDayRow = view === 'week'
    && weekDates.some((day) => (placement.allDayByDay.get(localDayKey(day)) ?? []).length > 0)

  // One roving grid serves month and week; dimensions depend on the view.
  const rowCount = view === 'month' ? weeks.length : HOURS.length + (hasAllDayRow ? 1 : 0)
  const isNavigable = (row: number, column: number): boolean =>
    view === 'month' ? Boolean(weeks[row]?.[column]) : true
  const defaultCell = React.useMemo<CellCoordinate | null>(() => {
    if (view === 'month') {
      for (let row = 0; row < weeks.length; row += 1) {
        for (let column = 0; column < 7; column += 1) {
          const day = weeks[row]![column]
          if (day && localDayKey(day) === todayKey) return [row, column]
        }
      }
      for (let row = 0; row < weeks.length; row += 1) {
        for (let column = 0; column < 7; column += 1) {
          if (weeks[row]![column]) return [row, column]
        }
      }
      return null
    }
    if (view === 'week') {
      const todayColumn = weekDates.findIndex((day) => localDayKey(day) === todayKey)
      return [hasAllDayRow ? 1 : 0, todayColumn >= 0 ? todayColumn : 0]
    }
    return null
  }, [view, weeks, weekDates, todayKey, hasAllDayRow])
  const { cellProps } = useRovingGrid(rowCount, 7, isNavigable, defaultCell)

  if (view === 'month') {
    return (
      <div
        role="grid"
        aria-label={label}
        data-calendar-grid=""
        data-view="month"
        className={cn(
          'grid content-start gap-px overflow-auto rounded-bakin-surface border border-bakin-border-subtle bg-bakin-border-subtle font-bakin-typography-family-ui',
          className,
        )}
      >
        <div role="row" className="grid grid-cols-7 gap-px">
          {DOW_LABELS.map((dow) => (
            <div
              key={dow}
              role="columnheader"
              className="bg-bakin-surface-default py-bakin-2 text-center text-bakin-typography-size-meta font-bakin-typography-weight-medium uppercase tracking-widest text-bakin-text-muted"
            >
              {dow}
            </div>
          ))}
        </div>
        {weeks.map((week, rowIndex) => (
          <div key={rowIndex} role="row" className="grid grid-cols-7 gap-px">
            {week.map((day, columnIndex) => {
              if (!day) {
                return (
                  <div
                    key={`blank-${columnIndex}`}
                    role="gridcell"
                    className="min-h-[6rem] bg-bakin-canvas-default/60"
                  />
                )
              }
              const dayKey = localDayKey(day)
              const dayItems = monthItemsFor(day)
              const isToday = dayKey === todayKey
              const isPast = day.getTime() < todayStart
              const expanded = expandedDays.has(dayKey)
              const visibleItems = expanded ? dayItems : dayItems.slice(0, maxVisibleItems)
              const hiddenCount = dayItems.length - visibleItems.length
              return (
                <div
                  key={dayKey}
                  {...cellProps(rowIndex, columnIndex, cellLabel([dayLabel(day)], dayItems.length))}
                  data-today={isToday ? '' : undefined}
                  data-past={isPast ? '' : undefined}
                  className={cn(
                    'min-h-[6rem] bg-bakin-canvas-default p-bakin-2 outline-none transition-colors focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-bakin-focus-ring',
                    isToday && 'bg-bakin-signal-accent/5',
                    dayItems.length > 0 && 'hover:bg-bakin-surface-default',
                  )}
                >
                  <div
                    aria-hidden="true"
                    data-slot="calendar-day-number"
                    className={cn(
                      'mb-bakin-2 flex size-bakin-6 items-center justify-center rounded-bakin-pill text-bakin-typography-size-meta',
                      isToday
                        ? 'bg-bakin-signal-accent font-bakin-typography-weight-semibold text-bakin-canvas-default'
                        : 'text-bakin-text-muted',
                    )}
                  >
                    {day.getDate()}
                  </div>
                  <div className={cn('flex flex-col gap-bakin-1', isPast && 'opacity-50')}>
                    {renderItems(visibleItems, renderItem)}
                    {(hiddenCount > 0 || expanded) && dayItems.length > maxVisibleItems ? (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        data-slot="calendar-overflow"
                        className="w-fit rounded-bakin-control pl-bakin-1 text-left text-bakin-typography-size-meta font-bakin-typography-weight-medium text-bakin-text-muted outline-none transition-colors hover:text-bakin-text-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring"
                        onClick={() => toggleDay(dayKey)}
                      >
                        {expanded ? 'Show less' : `+${hiddenCount} more`}
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    )
  }

  if (view === 'week') {
    const rowOffset = hasAllDayRow ? 1 : 0
    return (
      <div
        role="grid"
        aria-label={label}
        data-calendar-grid=""
        data-view="week"
        className={cn(
          'overflow-auto rounded-bakin-surface border border-bakin-border-subtle bg-bakin-canvas-default font-bakin-typography-family-ui',
          className,
        )}
      >
        <div
          role="row"
          className={cn('sticky top-0 z-10 grid bg-bakin-surface-default', WEEK_ROW_TEMPLATE)}
        >
          <div role="columnheader" className="py-bakin-2">
            <span className="sr-only">Time</span>
          </div>
          {weekDates.map((day) => {
            const isToday = localDayKey(day) === todayKey
            return (
              <div
                key={localDayKey(day)}
                role="columnheader"
                data-today={isToday ? '' : undefined}
                className={cn(
                  'border-l border-bakin-border-subtle px-bakin-1 py-bakin-2 text-center font-bakin-typography-weight-medium tracking-wide',
                  isToday ? 'text-bakin-signal-accent' : 'text-bakin-text-muted',
                )}
              >
                <span className="mb-bakin-1 block text-bakin-typography-size-meta uppercase leading-none tracking-widest">
                  {DOW_LABELS[day.getDay()]}
                </span>
                <span className={isToday ? 'text-bakin-signal-accent' : 'text-bakin-text-primary'}>
                  {day.getDate()}
                </span>
                {renderDayHeader?.(day)}
              </div>
            )
          })}
        </div>

        {hasAllDayRow ? (
          <div role="row" className={cn('grid', WEEK_ROW_TEMPLATE)}>
            <div
              role="rowheader"
              className="border-t border-bakin-border-subtle pr-bakin-2 pt-bakin-3 text-right text-bakin-typography-size-meta text-bakin-text-muted"
            >
              All day
            </div>
            {weekDates.map((day, columnIndex) => {
              const dayItems = placement.allDayByDay.get(localDayKey(day)) ?? []
              const isToday = localDayKey(day) === todayKey
              return (
                <div
                  key={localDayKey(day)}
                  {...cellProps(0, columnIndex, cellLabel([dayLabel(day), 'all day'], dayItems.length))}
                  data-today={isToday ? '' : undefined}
                  className={cn(
                    'min-h-bakin-12 border-l border-t border-bakin-border-subtle p-bakin-1 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-bakin-focus-ring',
                    isToday && 'bg-bakin-signal-accent/5',
                  )}
                >
                  {renderItems(dayItems, renderItem)}
                </div>
              )
            })}
          </div>
        ) : null}

        {HOURS.map((hour) => (
          <div key={hour} role="row" className={cn('grid', WEEK_ROW_TEMPLATE)}>
            <div
              role="rowheader"
              className="border-t border-bakin-border-subtle pr-bakin-2 pt-bakin-3 text-right font-bakin-typography-family-mono text-bakin-typography-size-meta tabular-nums text-bakin-text-muted"
            >
              {formatHour(hour)}
            </div>
            {weekDates.map((day, columnIndex) => {
              const cellItems = placement.byDayHour.get(`${localDayKey(day)}:${hour}`) ?? []
              const isToday = localDayKey(day) === todayKey
              return (
                <div
                  key={localDayKey(day)}
                  {...cellProps(
                    hour + rowOffset,
                    columnIndex,
                    cellLabel([dayLabel(day), formatHour(hour)], cellItems.length),
                  )}
                  data-today={isToday ? '' : undefined}
                  className={cn(
                    'min-h-bakin-12 border-l border-t border-bakin-border-subtle p-bakin-1 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-bakin-focus-ring',
                    isToday && 'bg-bakin-signal-accent/5',
                    cellItems.length === 0 && 'hover:bg-bakin-surface-default',
                  )}
                >
                  {renderItems(cellItems, renderItem)}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    )
  }

  // Day / agenda view: hour rows with the current hour marked.
  const anchorKey = localDayKey(date)
  const isCurrentDay = anchorKey === todayKey
  const allDayItems = placement.allDayByDay.get(anchorKey) ?? []
  return (
    <section
      aria-label={label}
      data-calendar-grid=""
      data-view="day"
      className={cn(
        'overflow-auto rounded-bakin-surface border border-bakin-border-subtle bg-bakin-canvas-default font-bakin-typography-family-ui',
        className,
      )}
    >
      <div className="divide-y divide-bakin-border-subtle">
        {allDayItems.length > 0 ? (
          <div data-slot="calendar-all-day" className="flex min-h-[3.5rem] gap-bakin-4 px-bakin-4 py-bakin-3">
            <div className="w-[4rem] shrink-0 pt-bakin-1">
              <span className="text-bakin-typography-size-meta text-bakin-text-muted">All day</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="grid grid-cols-1 gap-bakin-2 sm:grid-cols-2 lg:grid-cols-3">
                {renderItems(allDayItems, renderItem)}
              </div>
            </div>
          </div>
        ) : null}
        {HOURS.map((hour) => {
          const hourItems = placement.byDayHour.get(`${anchorKey}:${hour}`) ?? []
          const isCurrentHour = isCurrentDay && hour === currentInstant.getHours()
          return (
            <div
              key={hour}
              data-hour={hour}
              data-current-hour={isCurrentHour ? '' : undefined}
              className={cn(
                'flex min-h-[3.5rem] gap-bakin-4 px-bakin-4 py-bakin-3',
                isCurrentHour && 'bg-bakin-signal-accent/5',
              )}
            >
              <div className="w-[4rem] shrink-0 pt-bakin-1">
                <span
                  className={cn(
                    'font-bakin-typography-family-mono text-bakin-typography-size-meta tabular-nums',
                    isCurrentHour
                      ? 'font-bakin-typography-weight-medium text-bakin-signal-accent'
                      : 'text-bakin-text-muted',
                  )}
                >
                  {formatHour(hour)}
                </span>
                {isCurrentHour ? (
                  <div className="mt-bakin-1 h-[.125rem] w-full rounded-bakin-pill bg-bakin-signal-accent/50" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                {hourItems.length > 0 ? (
                  <div className="grid grid-cols-1 gap-bakin-2 sm:grid-cols-2 lg:grid-cols-3">
                    {renderItems(hourItems, renderItem)}
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
