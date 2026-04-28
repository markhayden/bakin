'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams, useRouter, usePathname } from '@bakin/sdk/hooks'
import { Button } from "@bakin/sdk/ui"
import { Input } from "@bakin/sdk/ui"
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  List,
  CalendarDays,
  CalendarRange,
  Check,
  X,
  Trash2,
  Link2,
  Search,
  FileText,
  Megaphone,
  Video as VideoIcon,
  ImageIcon,
  MessageSquare,
} from 'lucide-react'
import { PluginHeader } from "@bakin/sdk/components"
import { FacetFilter } from "@bakin/sdk/components"
import { Skeleton } from "@bakin/sdk/ui"
import { EmptyState } from "@bakin/sdk/components"
import { AgentFilter } from "@bakin/sdk/components"
import { AgentAvatar } from "@bakin/sdk/components"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@bakin/sdk/ui"
import { SortableHead, type SortDir } from "@bakin/sdk/components"
import { useQueryState, useQueryArrayState } from "@bakin/sdk/hooks"
import type { CalendarItem } from '../types'
import { STATUS_BADGE } from '../constants'
import { useAgentIds } from "@bakin/sdk/hooks"
import { useContentTypes, getContentTypeLabel } from '../hooks/use-content-types'
import { useNotificationChannels } from "@bakin/sdk/hooks"
import { ChannelIcon } from "@bakin/sdk/components"
import { ItemDetailDrawer } from './item-detail-drawer'
import { CalendarWeek } from './calendar-week'

/**
 * Agent colors use CSS custom properties from the agent settings system.
 * Each agent's --agent-{id} var is set by AgentThemeProvider.
 */
function agentColorStyle(agent: string): React.CSSProperties {
  const v = `var(--agent-${agent})`
  return {
    backgroundColor: `color-mix(in srgb, ${v} 20%, transparent)`,
    color: v,
    borderColor: `color-mix(in srgb, ${v} 30%, transparent)`,
  }
}

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft', icon: <span className="size-2 rounded-full bg-zinc-500" /> },
  { value: 'scheduled', label: 'Scheduled', icon: <span className="size-2 rounded-full bg-sky-500" /> },
  { value: 'executing', label: 'Executing', icon: <span className="size-2 rounded-full bg-amber-500" /> },
  { value: 'waiting', label: 'Waiting', icon: <span className="size-2 rounded-full bg-amber-500" /> },
  { value: 'review', label: 'Review', icon: <span className="size-2 rounded-full bg-yellow-500" /> },
  { value: 'published', label: 'Published', icon: <span className="size-2 rounded-full bg-emerald-500" /> },
  { value: 'failed', label: 'Failed', icon: <span className="size-2 rounded-full bg-red-500" /> },
]

const TYPE_ICONS: Record<string, React.ReactNode> = {
  post:         <MessageSquare className="size-3.5" />,
  article:      <FileText className="size-3.5" />,
  video:        <VideoIcon className="size-3.5" />,
  image:        <ImageIcon className="size-3.5" />,
  announcement: <Megaphone className="size-3.5" />,
}

type ViewMode = 'month' | 'week' | 'list'

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

function getWeekStart(date: Date): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d
}

function formatDateShort(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const VIEW_DEFS: { id: ViewMode; icon: typeof List; label: string }[] = [
  { id: 'month', icon: CalendarDays, label: 'Month' },
  { id: 'week', icon: CalendarRange, label: 'Week' },
  { id: 'list', icon: List, label: 'List' },
]

export function ContentCalendar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const contentTypes = useContentTypes()
  const agentIds = useAgentIds()
  const availableChannels = useNotificationChannels()
  const typeOptions = contentTypes.map(({ id, label }) => ({
    value: id,
    label,
    icon: TYPE_ICONS[id],
  }))
  const channelOptions = availableChannels.map(({ id, label }) => ({
    value: id,
    label,
    icon: <ChannelIcon channelId={id} className="size-3.5" />,
  }))

  // URL state
  const [view, setView] = useQueryState('view', 'week')
  const [agentFilter, setAgentFilter] = useQueryState('agent', 'all')
  const [statusFilter, setStatusFilter] = useQueryArrayState('status')
  const [typeFilter, setTypeFilter] = useQueryArrayState('type')
  const [channelFilter, setChannelFilter] = useQueryArrayState('channel')
  const [search, setSearch] = useQueryState('q', '')
  const [itemIdParam, setItemIdParam, pushItemId] = useQueryState('itemId', '')
  const [mode, setMode, pushMode] = useQueryState('mode', '')

  const [items, setItems] = useState<CalendarItem[]>([])
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [listSortField, setListSortField] = useState<'scheduledAt' | 'agent' | 'contentType' | 'title' | 'status'>('scheduledAt')
  const [listSortDir, setListSortDir] = useState<SortDir>('asc')

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`

  // Week view dates
  const weekStart = useMemo(() => getWeekStart(currentDate), [currentDate])
  const weekEnd = useMemo(() => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 6)
    return d
  }, [weekStart])

  const fetchItems = useCallback(async () => {
    try {
      // List view shows everything; month/week views scope to the current month.
      const url = view === 'list'
        ? '/api/plugins/messaging/'
        : `/api/plugins/messaging/?month=${monthKey}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setItems(data.items ?? data)
      }
    } catch { /* */ }
    setLoading(false)
  }, [monthKey, view])

  useEffect(() => { fetchItems() }, [fetchItems])

  // SSE live updates for calendar.json
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.file === 'messaging.json') fetchItems()
      } catch { /* */ }
    }
    return () => es.close()
  }, [fetchItems])

  // Filter items
  const filteredItems = items.filter(i => {
    if (agentFilter !== 'all' && i.agent !== agentFilter) return false
    if (statusFilter.length > 0 && !statusFilter.includes(i.status)) return false
    if (typeFilter.length > 0 && !typeFilter.includes(i.contentType)) return false
    if (channelFilter.length > 0) {
      if (!channelFilter.some(ch => i.channels.includes(ch))) return false
    }
    if (search) {
      const q = search.toLowerCase()
      if (
        !i.title.toLowerCase().includes(q) &&
        !(i.brief || '').toLowerCase().includes(q) &&
        !(i.draft?.caption || '').toLowerCase().includes(q) &&
        !(i.draft?.agentNotes || '').toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  const itemsByDate = new Map<string, CalendarItem[]>()
  for (const item of filteredItems) {
    const day = item.scheduledAt.slice(0, 10)
    const existing = itemsByDate.get(day) || []
    existing.push(item)
    itemsByDate.set(day, existing)
  }

  // Atomic multi-param update to avoid race conditions
  const updateParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') params.delete(k)
      else params.set(k, v)
    }
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, pathname, searchParams])

  // Derive drawer state from URL
  const selectedItem = itemIdParam ? items.find(i => i.id === itemIdParam) ?? null : null
  const showForm = mode === 'create' || (mode === 'edit' && !!selectedItem)
  const showDetail = !!selectedItem && !showForm

  // --- Transitions ---
  const openItem = (item: CalendarItem) => pushItemId(item.id)
  const closeItem = () => updateParams({ itemId: null, mode: null, date: null })

  const openCreate = (defaultDate?: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('itemId')
    params.set('mode', 'create')
    if (defaultDate) params.set('date', defaultDate)
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const openEdit = () => pushMode('edit')
  const cancelEdit = () => setMode('')  // back to detail view, keeps itemId

  async function handleApprove(id: string) {
    await fetch(`/api/plugins/messaging/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    fetchItems()
  }

  async function handleDelete(id: string) {
    await fetch(`/api/plugins/messaging/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    })
    fetchItems()
    if (itemIdParam === id) setItemIdParam('')
  }

  // --- Navigation ---
  function prevPeriod() {
    if (view === 'month') {
      setCurrentDate(new Date(year, month - 1, 1))
      setSelectedDay(null)
    } else {
      const d = new Date(currentDate)
      d.setDate(d.getDate() - 7)
      setCurrentDate(d)
    }
  }

  function nextPeriod() {
    if (view === 'month') {
      setCurrentDate(new Date(year, month + 1, 1))
      setSelectedDay(null)
    } else {
      const d = new Date(currentDate)
      d.setDate(d.getDate() + 7)
      setCurrentDate(d)
    }
  }

  function goToday() {
    setCurrentDate(new Date())
    setSelectedDay(null)
  }

  const todayStr = new Date().toISOString().slice(0, 10)

  // Navigation label
  const navLabel = view === 'month'
    ? `${MONTH_NAMES[month]} ${year}`
    : view === 'week'
      ? `${formatDateShort(weekStart)} — ${formatDateShort(weekEnd)}`
      : ''

  // ─── Month View ─────────────────────────────────────────────────
  function renderMonth() {
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
                  onClick={() => openCreate(selectedDay + 'T10:00')}
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
                    onClick={() => openItem(item)}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/50 transition-colors w-full"
                  >
                    <AgentAvatar agentId={item.agent} size="xs" />
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
                      role="button"
                      onClick={(e) => { e.stopPropagation(); openItem(item) }}
                      className="text-[10px] leading-tight px-1 py-0.5 rounded border hover:brightness-125 transition-all flex items-center gap-0.5"
                      style={agentColorStyle(item.agent)}
                    >
                      {item.sessionId && (
                        <Link2
                          className="size-2.5 shrink-0 opacity-60"
                          onClick={(e) => {
                            e.stopPropagation()
                            setView('brainstorm')
                            // Navigate to session via URL
                            const params = new URLSearchParams(searchParams.toString())
                            params.set('view', 'brainstorm')
                            params.set('session', item.sessionId!)
                            router.push(`${pathname}?${params.toString()}`, { scroll: false })
                          }}
                        />
                      )}
                      <span className="truncate">{item.title}</span>
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
  const toggleListSort = useCallback((field: typeof listSortField) => {
    if (listSortField === field) {
      setListSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setListSortField(field)
      setListSortDir('asc')
    }
  }, [listSortField])

  function renderList() {
    const sorted = [...filteredItems].sort((a, b) => {
      let cmp = 0
      if (listSortField === 'scheduledAt') cmp = a.scheduledAt.localeCompare(b.scheduledAt)
      else if (listSortField === 'agent') cmp = a.agent.localeCompare(b.agent)
      else if (listSortField === 'contentType') cmp = a.contentType.localeCompare(b.contentType)
      else if (listSortField === 'title') cmp = a.title.localeCompare(b.title)
      else if (listSortField === 'status') cmp = a.status.localeCompare(b.status)
      return listSortDir === 'asc' ? cmp : -cmp
    })

    return (
      <div>
        {sorted.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No items match filters" />
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead field="scheduledAt" current={listSortField} dir={listSortDir} onSort={toggleListSort}>Date</SortableHead>
                  <SortableHead field="agent" current={listSortField} dir={listSortDir} onSort={toggleListSort}>Agent</SortableHead>
                  <SortableHead field="contentType" current={listSortField} dir={listSortDir} onSort={toggleListSort}>Type</SortableHead>
                  <SortableHead field="title" current={listSortField} dir={listSortDir} onSort={toggleListSort}>Title</SortableHead>
                  <SortableHead field="status" current={listSortField} dir={listSortDir} onSort={toggleListSort}>Status</SortableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(item => (
                  <TableRow
                    key={item.id}
                    className="group cursor-pointer"
                    onClick={() => openItem(item)}
                  >
                    <TableCell className="font-mono text-muted-foreground text-xs">
                      {item.scheduledAt.slice(0, 16).replace('T', ' ')}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <AgentAvatar agentId={item.agent} size="xs" />
                        <span className="text-xs capitalize">{item.agent}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {getContentTypeLabel(item.contentType, contentTypes)}
                    </TableCell>
                    <TableCell className="text-foreground max-w-[240px] truncate">
                      <span className="flex items-center gap-1 text-xs">
                        {item.sessionId && <Link2 className="size-3 text-muted-foreground shrink-0" />}
                        {item.title}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_BADGE[item.status]}`}>
                        {item.status === 'waiting'
                          ? `waiting: ${item.draft?.videoPrompt ? 'video' : 'image'}`
                          : item.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    )
  }

  // ─── Main Layout ────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <PluginHeader
        title="Calendar"
        count={filteredItems.length}
        actions={
          <div className="flex items-center gap-3">
            <div className="relative w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search calendar..."
                className="pl-9 h-8 bg-surface border-border"
              />
            </div>
            <div className="flex items-center rounded-lg bg-muted/50 p-0.5">
              {VIEW_DEFS.map(v => (
                <button
                  key={v.id}
                  onClick={() => setView(v.id)}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                    view === v.id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <v.icon className="size-3" />
                  {v.label}
                </button>
              ))}
            </div>
            <Button size="sm" onClick={() => openCreate()}>
              <Plus className="size-3.5" data-icon="inline-start" />
              New Item
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3 mt-4 mb-4">
        <AgentFilter agentIds={agentIds} value={agentFilter} onChange={setAgentFilter} />
        <FacetFilter
          label="Status"
          options={STATUS_OPTIONS}
          selected={statusFilter}
          onChange={setStatusFilter}
        />
        <FacetFilter
          label="Type"
          options={typeOptions}
          selected={typeFilter}
          onChange={setTypeFilter}
        />
        <FacetFilter
          label="Channel"
          options={channelOptions}
          selected={channelFilter}
          onChange={setChannelFilter}
        />
      </div>

      {/* Date navigation — own row, centered above the calendar */}
      {(view === 'month' || view === 'week') && (
        <div className="flex items-center justify-center gap-1 mb-4">
          <Button size="icon-xs" variant="ghost" onClick={prevPeriod}>
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="text-sm font-medium text-foreground min-w-[160px] text-center">
            {navLabel}
          </span>
          <Button size="icon-xs" variant="ghost" onClick={nextPeriod}>
            <ChevronRight className="size-3.5" />
          </Button>
          <Button size="xs" variant="ghost" className="ml-1 text-muted-foreground" onClick={goToday}>
            Today
          </Button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : (
        <>
          {view === 'month' && renderMonth()}
          {view === 'week' && (
            <CalendarWeek
              items={filteredItems}
              weekStart={weekStart}
              onSelectItem={openItem}
              onAddItem={(dateStr) => openCreate(dateStr)}
            />
          )}
          {view === 'list' && renderList()}
        </>
      )}

      {/* Item Detail/Edit Drawer */}
      <ItemDetailDrawer
        item={selectedItem}
        open={showDetail || showForm}
        editing={showForm}
        onClose={closeItem}
        onCancelEdit={cancelEdit}
        onEdit={openEdit}
        onUpdated={fetchItems}
        onDelete={handleDelete}
        defaultDate={searchParams.get('date') ?? undefined}
      />
    </div>
  )
}
