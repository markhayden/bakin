'use client'

import { useMemo } from 'react'
import { AgentAvatar } from "@bakin/sdk/components"
import { Plus } from 'lucide-react'
import type { CalendarItem } from '../types'
import { STATUS_BADGE } from '../constants'

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6) // 6am–10pm

function formatHour(h: number) {
  if (h === 0 || h === 12) return h === 0 ? '12 AM' : '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface Props {
  items: CalendarItem[]
  weekStart: Date
  onSelectItem: (item: CalendarItem) => void
  onAddItem: (dateStr: string) => void
}

export function CalendarWeek({ items, weekStart, onSelectItem, onAddItem }: Props) {
  const todayStr = new Date().toISOString().slice(0, 10)
  const now = new Date()
  const currentHour = now.getHours()

  // Build 7 days from weekStart
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      return { date: d, str: toDateStr(d) }
    })
  }, [weekStart])

  // Group items by date + hour
  const itemMap = useMemo(() => {
    const map = new Map<string, CalendarItem[]>() // key: "YYYY-MM-DD:HH"
    for (const item of items) {
      const dateStr = item.scheduledAt.slice(0, 10)
      const hour = parseInt(item.scheduledAt.slice(11, 13), 10)
      const key = `${dateStr}:${hour}`
      const existing = map.get(key) || []
      existing.push(item)
      map.set(key, existing)
    }
    return map
  }, [items])

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[900px]">
        {/* Header row */}
        <div className="grid gap-px bg-border rounded-t-lg overflow-hidden" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
          <div className="bg-surface" />
          {days.map(({ date, str }) => {
            const isToday = str === todayStr
            return (
              <div
                key={str}
                className={`bg-surface px-2 py-2 text-center ${isToday ? 'bg-blue-500/[0.08]' : ''}`}
              >
                <div className={`text-[10px] uppercase tracking-wider font-medium ${isToday ? 'text-blue-400' : 'text-muted-foreground'}`}>
                  {DAY_LABELS[date.getDay()]}
                </div>
                <div className={`text-sm font-semibold ${isToday ? 'text-blue-400' : 'text-foreground'}`}>
                  {date.getDate()}
                </div>
              </div>
            )
          })}
        </div>

        {/* Hour rows */}
        <div className="grid gap-px bg-border rounded-b-lg overflow-hidden" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
          {HOURS.map(hour => {
            const isPast = days.every(d => {
              if (d.str < todayStr) return true
              if (d.str === todayStr && hour < currentHour) return true
              return false
            })

            return (
              <div key={hour} className="contents">
                {/* Hour gutter */}
                <div className={`bg-surface px-2 py-1 text-right min-h-[56px] ${isPast ? 'opacity-40' : ''}`}>
                  <span className="text-[10px] text-muted-foreground font-mono">{formatHour(hour)}</span>
                </div>

                {/* Day cells */}
                {days.map(({ str }) => {
                  const key = `${str}:${hour}`
                  const cellItems = itemMap.get(key) || []
                  const isToday = str === todayStr
                  const isCurrent = isToday && hour === currentHour
                  const cellPast = str < todayStr || (str === todayStr && hour < currentHour)

                  return (
                    <div
                      key={key}
                      className={`bg-background min-h-[56px] p-1 transition-colors group/cell ${
                        isToday ? 'bg-blue-500/[0.03]' : ''
                      } ${isCurrent ? 'bg-blue-500/[0.06]' : ''} ${
                        cellPast ? 'opacity-50 saturate-[0.3]' : ''
                      }`}
                    >
                      {cellItems.map(item => (
                        <button
                          key={item.id}
                          onClick={() => onSelectItem(item)}
                          className="w-full text-left rounded-md px-1.5 py-1 mb-0.5 border border-border/50 bg-surface hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-start gap-1.5">
                            <AgentAvatar agentId={item.agent} size="xs" className="mt-0.5" />
                            <span className="text-[11px] text-foreground flex-1">{item.title}</span>
                          </div>
                          <div className="flex items-center gap-1 mt-0.5 ml-[26px]">
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {item.scheduledAt.slice(11, 16)}
                            </span>
                            <span className={`text-[9px] px-1 py-0 rounded ${STATUS_BADGE[item.status]}`}>
                              {item.status}
                            </span>
                          </div>
                        </button>
                      ))}
                      {cellItems.length === 0 && !cellPast && (
                        <button
                          onClick={() => onAddItem(`${str}T${String(hour).padStart(2, '0')}:00`)}
                          className="w-full h-full flex items-center justify-center opacity-0 group-hover/cell:opacity-100 transition-opacity"
                        >
                          <Plus className="size-3 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
