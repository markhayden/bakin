'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  /** Dates that have proposals (YYYY-MM-DD format) */
  proposalDates: string[]
  /** Callback when a day is clicked */
  onDayClick?: (date: string) => void
  /** Currently selected date */
  selectedDate?: string
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function MiniCalendar({ proposalDates, onDayClick, selectedDate }: Props) {
  const [viewDate, setViewDate] = useState(() => new Date())

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()

  const proposalSet = useMemo(() => new Set(proposalDates), [proposalDates])
  const todayStr = new Date().toISOString().slice(0, 10)

  const cells = useMemo(() => {
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const firstDay = new Date(year, month, 1).getDay()
    const result: (number | null)[] = []
    for (let i = 0; i < firstDay; i++) result.push(null)
    for (let d = 1; d <= daysInMonth; d++) result.push(d)
    while (result.length % 7 !== 0) result.push(null)
    return result
  }, [year, month])

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1))
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1))

  return (
    <div className="w-full" data-testid="mini-calendar">
      {/* Navigation */}
      <div className="flex items-center justify-between mb-2">
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={prevMonth}>
          <ChevronLeft className="size-3" />
        </Button>
        <span className="text-xs font-medium text-foreground">
          {MONTHS[month]} {year}
        </span>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={nextMonth}>
          <ChevronRight className="size-3" />
        </Button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-0">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[10px] text-muted-foreground py-1">
            {d}
          </div>
        ))}

        {/* Day cells */}
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={`e-${i}`} className="h-7" />
          }

          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const isToday = dateStr === todayStr
          const isSelected = dateStr === selectedDate
          const hasProposal = proposalSet.has(dateStr)

          return (
            <button
              key={dateStr}
              onClick={() => onDayClick?.(dateStr)}
              className={`relative h-7 flex items-center justify-center text-[11px] rounded transition-colors
                ${isSelected ? 'bg-accent text-accent-foreground' : ''}
                ${isToday && !isSelected ? 'font-bold text-foreground' : ''}
                ${!isSelected && !isToday ? 'text-muted-foreground hover:text-foreground hover:bg-muted/50' : ''}
              `}
              data-testid={`day-${dateStr}`}
            >
              {day}
              {hasProposal && (
                <span
                  className="absolute bottom-0.5 left-1/2 -translate-x-1/2 size-1 rounded-full bg-accent"
                  data-testid={`dot-${dateStr}`}
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
