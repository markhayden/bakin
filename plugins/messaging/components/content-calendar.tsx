'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  UtensilsCrossed,
  Lightbulb,
  Sparkles,
  Dumbbell,
  Trees,
  Video as VideoIcon,
  ImageIcon,
  MessageSquare,
  Instagram,
  Mail,
  Twitter,
  Youtube,
  Music2,
} from 'lucide-react'
import { PluginHeader } from '@/components/plugin-header'
import { FacetFilter } from '@/components/facet-filter'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'
import { AgentFilter } from '@/components/agent-filter'
import { AgentAvatar } from '@/components/agent-avatar'
import { useQueryState, useQueryArrayState } from '@/hooks/use-query-state'
import type { CalendarItem, ContentAgent } from '../types'
import { AGENT_INFO } from '../types'
import { CONTENT_AGENTS, STATUS_BADGE, CONTENT_TYPE_LABELS, CHANNEL_LABELS } from '../constants'
import { ItemDetailDrawer } from './item-detail-drawer'
import { CalendarWeek } from './calendar-week'

/**
 * Agent colors use CSS custom properties from the agent settings system.
 * Each agent's --agent-{id} var is set by AgentThemeProvider.
 */
function agentColorStyle(agent: ContentAgent): React.CSSProperties {
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
  recipe: <UtensilsCrossed className="size-3.5" />,
  tip: <Lightbulb className="size-3.5" />,
  motivation: <Sparkles className="size-3.5" />,
  workout: <Dumbbell className="size-3.5" />,
  outdoor: <Trees className="size-3.5" />,
  video: <VideoIcon className="size-3.5" />,
  'image-post': <ImageIcon className="size-3.5" />,
}

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  discord: <MessageSquare className="size-3.5" />,
  instagram: <Instagram className="size-3.5" />,
  email: <Mail className="size-3.5" />,
  twitter: <Twitter className="size-3.5" />,
  youtube: <Youtube className="size-3.5" />,
  tiktok: <Music2 className="size-3.5" />,
}

const TYPE_OPTIONS = Object.entries(CONTENT_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
  icon: TYPE_ICONS[value],
}))
const CHANNEL_OPTIONS = Object.entries(CHANNEL_LABELS).map(([value, label]) => ({
  value,
  label,
  icon: CHANNEL_ICONS[value],
}))

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
      const res = await fetch(`/api/plugins/messaging/?month=${monthKey}`)
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
      const itemChannels = i.channels || (i.channel ? [i.channel] : [])
      if (!channelFilter.some(ch => itemChannels.includes(ch))) return false
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

  const closeForm = () => {
    updateParams({ mode: null, date: null })
    fetchItems()
  }

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
                      className="text-[10px] leading-tight px-1 py-0.5 rounded border cursor-pointer hover:brightness-125 transition-all flex items-center gap-0.5"
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
  function renderList() {
    const sorted = [...filteredItems].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))

    return (
      <div>
        {sorted.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No items match filters" />
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
                    className="group border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => openItem(item)}
                  >
                    <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">
                      {item.scheduledAt.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <AgentAvatar agentId={item.agent} size="xs" />
                        <span className="capitalize">{item.agent}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{item.contentType}</td>
                    <td className="px-3 py-2 text-foreground max-w-[240px] truncate">
                      <span className="flex items-center gap-1">
                        {item.sessionId && <Link2 className="size-3 text-muted-foreground shrink-0" />}
                        {item.title}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_BADGE[item.status]}`}>
                        {item.status === 'waiting'
                          ? `waiting: ${item.draft?.videoPrompt ? 'video' : 'image'}`
                          : item.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right" onClick={e => e.stopPropagation()}>
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
      {/* Header */}
      <PluginHeader
        title="Calendar"
        count={filteredItems.length}
        actions={
          <div className="flex items-center gap-3">
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

      {/* Filters + date nav */}
      {(
        <div className="flex items-center gap-3 mt-4 mb-4">
          <AgentFilter agentIds={[...CONTENT_AGENTS]} value={agentFilter} onChange={setAgentFilter} />
          <FacetFilter
            label="Status"
            options={STATUS_OPTIONS}
            selected={statusFilter}
            onChange={setStatusFilter}
          />
          <FacetFilter
            label="Type"
            options={TYPE_OPTIONS}
            selected={typeFilter}
            onChange={setTypeFilter}
          />
          <FacetFilter
            label="Channel"
            options={CHANNEL_OPTIONS}
            selected={channelFilter}
            onChange={setChannelFilter}
          />

          {/* Search + date navigation — far right */}
          <div className="flex items-center gap-2 ml-auto shrink-0">
            <div className="relative w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search calendar..."
                className="pl-9 h-8 bg-surface border-border"
              />
            </div>
            {(view === 'month' || view === 'week') && (
              <div className="flex items-center gap-1">
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
          </div>
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
