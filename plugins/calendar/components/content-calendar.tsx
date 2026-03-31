'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  List,
  CalendarDays,
  Sparkles,
  Check,
  X,
  Eye,
  Trash2,
} from 'lucide-react'
import type { CalendarItem, ContentAgent, ContentStatus } from '../types'
import { NewItemForm } from './new-item-form'
import { ItemDetailPanel } from './item-detail-panel'
import { BrainstormPanel } from './brainstorm-panel'

/**
 * Agent colors now use CSS custom properties from the agent settings system.
 * Each agent's --agent-{id} var is set by AgentThemeProvider.
 * These utility functions generate inline styles from the CSS vars.
 */
function agentColorStyle(agent: ContentAgent): React.CSSProperties {
  const v = `var(--agent-${agent})`
  return {
    backgroundColor: `color-mix(in srgb, ${v} 20%, transparent)`,
    color: v,
    borderColor: `color-mix(in srgb, ${v} 30%, transparent)`,
  }
}

function agentDotStyle(agent: ContentAgent): React.CSSProperties {
  return { backgroundColor: `var(--agent-${agent})` }
}

const STATUS_BADGE: Record<ContentStatus, string> = {
  draft: 'bg-zinc-500/20 text-zinc-400',
  scheduled: 'bg-sky-500/20 text-sky-400',
  executing: 'bg-amber-500/20 text-amber-400',
  waiting: 'bg-amber-500/20 text-amber-400',
  review: 'bg-yellow-500/20 text-yellow-300',
  published: 'bg-emerald-500/20 text-emerald-400',
  failed: 'bg-red-500/20 text-red-400',
}

type ViewMode = 'calendar' | 'list' | 'brainstorm'

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function ContentCalendar() {
  const [items, setItems] = useState<CalendarItem[]>([])
  const [view, setView] = useState<ViewMode>('list')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [selectedItem, setSelectedItem] = useState<CalendarItem | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newFormDate, setNewFormDate] = useState<string | undefined>()
  const [filterAgent, setFilterAgent] = useState<ContentAgent | 'all'>('all')
  const [filterStatus, setFilterStatus] = useState<ContentStatus | 'all'>('all')
  const [loading, setLoading] = useState(true)

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch(`/api/plugins/calendar/items?month=${monthKey}`)
      if (res.ok) {
        const data = await res.json()
        setItems(data.items ?? data)
      }
    } catch { /* */ }
    setLoading(false)
  }, [monthKey])

  useEffect(() => { fetchItems() }, [fetchItems])

  // SSE live updates for calendar.json
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.file === 'calendar.json') {
          fetchItems()
        }
      } catch { /* */ }
    }
    return () => es.close()
  }, [fetchItems])

  const filteredItems = items.filter(i => {
    if (filterAgent !== 'all' && i.agent !== filterAgent) return false
    if (filterStatus !== 'all' && i.status !== filterStatus) return false
    return true
  })

  const itemsByDate = new Map<string, CalendarItem[]>()
  for (const item of filteredItems) {
    const day = item.scheduledAt.slice(0, 10)
    const existing = itemsByDate.get(day) || []
    existing.push(item)
    itemsByDate.set(day, existing)
  }

  async function handleApprove(id: string) {
    await fetch('/api/plugins/calendar/items/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    fetchItems()
    if (selectedItem?.id === id) {
      const updated = await fetch(`/api/plugins/calendar/items?month=${monthKey}`).then(r => r.json())
      setSelectedItem(updated.find((i: CalendarItem) => i.id === id) || null)
    }
  }

  async function handleReject(id: string, note: string) {
    await fetch('/api/plugins/calendar/items/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, rejectionNote: note }),
    })
    fetchItems()
    setSelectedItem(null)
  }

  async function handleDelete(id: string) {
    await fetch('/api/plugins/calendar/items/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    fetchItems()
    setSelectedItem(null)
  }

  async function handleCreate(data: Record<string, unknown>) {
    await fetch('/api/plugins/calendar/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    fetchItems()
    setShowNewForm(false)
  }

  async function handleUpdate(id: string, updates: Record<string, unknown>) {
    await fetch('/api/plugins/calendar/items/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...updates }),
    })
    fetchItems()
  }

  function prevMonth() {
    setCurrentDate(new Date(year, month - 1, 1))
    setSelectedDay(null)
  }

  function nextMonth() {
    setCurrentDate(new Date(year, month + 1, 1))
    setSelectedDay(null)
  }

  function goToday() {
    setCurrentDate(new Date())
    setSelectedDay(null)
  }

  const todayStr = new Date().toISOString().slice(0, 10)

  // ─── Calendar View ──────────────────────────────────────────────
  function renderCalendar() {
    const daysInMonth = getDaysInMonth(year, month)
    const firstDay = getFirstDayOfMonth(year, month)
    const cells: (number | null)[] = []

    for (let i = 0; i < firstDay; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)
    while (cells.length % 7 !== 0) cells.push(null)

    return (
      <div>
        {/* Day sidebar */}
        {selectedDay && (
          <div className="mb-4 rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">{selectedDay}</h3>
              <div className="flex gap-1">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    setNewFormDate(selectedDay + 'T10:00')
                    setShowNewForm(true)
                  }}
                >
                  <Plus className="size-3" />
                  Add
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setSelectedDay(null)}>
                  <X className="size-3" />
                </Button>
              </div>
            </div>
            {(itemsByDate.get(selectedDay) || []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No items scheduled.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {(itemsByDate.get(selectedDay) || []).map(item => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedItem(item)}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/50 transition-colors w-full"
                  >
                    <span className="size-2 rounded-full shrink-0" style={agentDotStyle(item.agent)} />
                    <span className="text-xs text-foreground truncate flex-1">{item.title}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_BADGE[item.status]}`}>
                      {item.status}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Grid */}
        <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="bg-surface px-2 py-1.5 text-center text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {d}
            </div>
          ))}
          {cells.map((day, i) => {
            if (day === null) {
              return <div key={`e-${i}`} className="bg-background/50 min-h-[80px]" />
            }
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const dayItems = itemsByDate.get(dateStr) || []
            const isToday = dateStr === todayStr
            const isSelected = dateStr === selectedDay

            return (
              <button
                key={dateStr}
                onClick={() => setSelectedDay(dateStr === selectedDay ? null : dateStr)}
                className={`bg-background min-h-[80px] p-1.5 text-left transition-colors hover:bg-muted/30 ${
                  isSelected ? 'ring-1 ring-accent ring-inset' : ''
                }`}
              >
                <span className={`text-xs font-medium inline-flex items-center justify-center size-6 rounded-full ${
                  isToday ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
                }`}>
                  {day}
                </span>
                <div className="mt-1 flex flex-col gap-0.5">
                  {dayItems.slice(0, 3).map(item => (
                    <div
                      key={item.id}
                      className="text-[10px] leading-tight px-1 py-0.5 rounded truncate border"
                      style={agentColorStyle(item.agent)}
                    >
                      {item.title}
                    </div>
                  ))}
                  {dayItems.length > 3 && (
                    <span className="text-[10px] text-muted-foreground pl-1">+{dayItems.length - 3} more</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ─── List View ──────────────────────────────────────────────────
  function renderList() {
    const sorted = [...filteredItems].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))

    return (
      <div>
        {/* Filters */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <select
            className="h-7 rounded-md border border-input bg-transparent px-2 text-xs"
            value={filterAgent}
            onChange={e => setFilterAgent(e.target.value as ContentAgent | 'all')}
          >
            <option value="all">All Agents</option>
            <option value="basil">Basil</option>
            <option value="scout">Scout</option>
            <option value="nemo">Nemo</option>
            <option value="zen">Zen</option>
          </select>
          <select
            className="h-7 rounded-md border border-input bg-transparent px-2 text-xs"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as ContentStatus | 'all')}
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="scheduled">Scheduled</option>
            <option value="executing">Executing</option>
            <option value="waiting">Waiting</option>
            <option value="review">Review</option>
            <option value="published">Published</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No items match filters.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface border-b border-border">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Agent</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Type</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Title</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(item => (
                  <tr
                    key={item.id}
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => setSelectedItem(item)}
                  >
                    <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">
                      {item.scheduledAt.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={agentDotStyle(item.agent)} />
                        <span className="capitalize">{item.agent}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{item.contentType}</td>
                    <td className="px-3 py-2 text-foreground max-w-[240px] truncate">{item.title}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_BADGE[item.status]}`}>
                        {item.status === 'waiting'
                          ? `waiting: ${item.draft?.videoPrompt ? 'video' : 'image'}`
                          : item.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button size="icon-xs" variant="ghost" onClick={() => setSelectedItem(item)}>
                          <Eye className="size-3" />
                        </Button>
                        {(item.status === 'draft' || item.status === 'review') && (
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className="text-emerald-400 hover:text-emerald-300"
                            onClick={() => handleApprove(item.id)}
                          >
                            <Check className="size-3" />
                          </Button>
                        )}
                        {item.status === 'draft' && (
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className="text-red-400 hover:text-red-300"
                            onClick={() => handleDelete(item.id)}
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // ─── Main Layout ────────────────────────────────────────────────
  return (
    <div>
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-foreground">Calendar</h1>
          {view === 'calendar' && (
            <div className="flex items-center gap-1">
              <Button size="icon-xs" variant="ghost" onClick={prevMonth}>
                <ChevronLeft className="size-3.5" />
              </Button>
              <span className="text-sm font-medium text-foreground min-w-[140px] text-center">
                {MONTH_NAMES[month]} {year}
              </span>
              <Button size="icon-xs" variant="ghost" onClick={nextMonth}>
                <ChevronRight className="size-3.5" />
              </Button>
              <Button size="xs" variant="ghost" className="ml-1 text-muted-foreground" onClick={goToday}>
                Today
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          {/* Agent legend */}
          <div className="flex items-center gap-3">
            {(['basil', 'scout', 'nemo', 'zen'] as ContentAgent[]).map(agent => (
              <div key={agent} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={agentDotStyle(agent)} />
                <span className="text-xs text-muted-foreground capitalize">{agent}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center rounded-lg border border-border bg-surface p-0.5">
            <button
              onClick={() => setView('calendar')}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                view === 'calendar' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <CalendarDays className="size-3" />
              Calendar
            </button>
            <button
              onClick={() => setView('list')}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                view === 'list' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <List className="size-3" />
              List
            </button>
            <button
              onClick={() => setView('brainstorm')}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                view === 'brainstorm' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Sparkles className="size-3" />
              Brainstorm
            </button>
          </div>
          <Button size="sm" onClick={() => { setNewFormDate(undefined); setShowNewForm(true) }}>
            <Plus className="size-3.5" data-icon="inline-start" />
            New Item
          </Button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <span className="text-sm text-muted-foreground">Loading calendar...</span>
        </div>
      ) : (
        <>
          {view === 'calendar' && renderCalendar()}
          {view === 'list' && renderList()}
          {view === 'brainstorm' && (
            <BrainstormPanel onItemCreated={fetchItems} />
          )}
        </>
      )}

      {/* New Item Modal */}
      {showNewForm && (
        <NewItemForm
          open={true}
          defaultDate={newFormDate ? new Date(newFormDate) : undefined}
          onCreated={fetchItems}
          onClose={() => setShowNewForm(false)}
        />
      )}

      {/* Item Detail Panel */}
      {selectedItem && (
        <ItemDetailPanel
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onUpdated={fetchItems}
        />
      )}
    </div>
  )
}
