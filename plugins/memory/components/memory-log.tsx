'use client'

import { useState, useMemo, useCallback } from 'react'
import { useContentStore } from '@/hooks/use-content-store'
import { parseMemoryLog } from '../parser'
import { Search, Plus, ChevronDown } from 'lucide-react'
import type { MemoryEntry } from '@/types'

const TYPE_CONFIG = {
  decision: {
    label: 'Decision',
    border: 'border-l-blue-500',
    badge: 'bg-blue-500/10 text-blue-400',
    dot: 'bg-blue-500/40',
    activePill: 'bg-blue-600/10 text-blue-400 border border-blue-500/20',
  },
  learned: {
    label: 'Learned',
    border: 'border-l-emerald-500',
    badge: 'bg-emerald-500/10 text-emerald-400',
    dot: 'bg-emerald-500/40',
    activePill: 'bg-emerald-600/10 text-emerald-400 border border-emerald-500/20',
  },
  note: {
    label: 'Note',
    border: 'border-l-zinc-600',
    badge: 'bg-zinc-800 text-zinc-400',
    dot: 'bg-zinc-500/40',
    activePill: 'bg-zinc-700/50 text-zinc-300 border border-zinc-600/30',
  },
} as const

function extractAgent(text: string): string {
  // Try to extract agent name from the text patterns like "(via Main Operator)" or "@main-operator"
  // For now, return empty — entries don't currently embed agent names
  return ''
}

function getRelativeDate(dateStr: string): string {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  if (dateStr === today) return 'Today'
  if (dateStr === yesterday) return 'Yesterday'
  const d = new Date(dateStr + 'T00:00:00')
  const diffMs = Date.now() - d.getTime()
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays < 7) return `${diffDays} days ago`
  return ''
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function stripPrefix(text: string): string {
  return text
    .replace(/^\*\*Decision:\*\*\s*/, '')
    .replace(/^\*\*Learned:\*\*\s*/, '')
}

type FilterType = 'all' | MemoryEntry['type']

export function MemoryLog() {
  const files = useContentStore((s) => s.files)
  const content = files['MEMORY-LOG.md'] || ''
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [filterAgent, setFilterAgent] = useState('all')
  const [showAddForm, setShowAddForm] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [newType, setNewType] = useState<MemoryEntry['type']>('decision')
  const [newText, setNewText] = useState('')

  const days = useMemo(() => {
    const parsed = parseMemoryLog(content)
    // Sort newest day first, newest entries within each day first
    return [...parsed]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(d => ({ ...d, entries: [...d.entries].reverse() }))
  }, [content])

  // Extract unique agents from entries (future-proof — currently entries don't have agents)
  const agents = useMemo(() => {
    const set = new Set<string>()
    for (const day of days) {
      for (const entry of day.entries) {
        const agent = extractAgent(entry.text)
        if (agent) set.add(agent)
      }
    }
    return Array.from(set).sort()
  }, [days])

  const filtered = useMemo(() => {
    return days
      .map((d) => ({
        ...d,
        entries: d.entries.filter((e) => {
          if (filterType !== 'all' && e.type !== filterType) return false
          if (filterAgent !== 'all') {
            const agent = extractAgent(e.text)
            if (agent !== filterAgent) return false
          }
          if (search) {
            const q = search.toLowerCase()
            if (!e.text.toLowerCase().includes(q)) return false
          }
          return true
        }),
      }))
      .filter((d) => d.entries.length > 0)
  }, [days, filterType, filterAgent, search])

  const handleSubmit = useCallback(async () => {
    if (!newText.trim() || isSubmitting) return
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/memory/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: newType, agent: 'main-operator', text: newText.trim() }),
      })
      if (res.ok) {
        setNewText('')
        setShowAddForm(false)
      }
    } catch {
      // silent fail — SSE will update if it went through
    } finally {
      setIsSubmitting(false)
    }
  }, [newText, newType, isSubmitting])

  const today = new Date().toISOString().slice(0, 10)
  const isToday = (dateStr: string) => dateStr === today

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Memory</h1>
          <p className="text-sm text-zinc-500 mt-1">LTM (Long Term Memory) logs for all active agents.</p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="bg-blue-600 hover:bg-blue-500 transition-colors text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-lg shadow-blue-900/20"
        >
          <Plus className="size-4" />
          Add Entry
        </button>
      </div>

      {/* Quick Add Form */}
      {showAddForm && (
        <div className="mb-8 p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as MemoryEntry['type'])}
                className="bg-zinc-950 border border-zinc-800 text-xs rounded-md px-2 py-1.5 text-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="decision">Decision</option>
                <option value="learned">Learned</option>
                <option value="note">Note</option>
              </select>
            </div>
            <textarea
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="Record a new memory entry..."
              className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 border-none focus:ring-0 focus:outline-none resize-none h-12 py-1"
            />
            <div className="flex justify-end border-t border-zinc-800 pt-3 gap-2">
              <button
                onClick={() => { setShowAddForm(false); setNewText('') }}
                className="text-xs font-medium text-zinc-400 hover:text-white px-3 py-1"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!newText.trim() || isSubmitting}
                className="text-xs font-medium bg-zinc-100 text-zinc-950 px-4 py-1.5 rounded-md hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Saving...' : 'Save Entry'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-6 mb-10 pb-6 border-b border-zinc-900">
        {/* Type pills */}
        <div className="flex items-center p-1 bg-zinc-900/50 rounded-lg border border-zinc-800">
          <button
            onClick={() => setFilterType('all')}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
              filterType === 'all'
                ? 'bg-zinc-700/50 text-zinc-200 border border-zinc-600/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            All
          </button>
          {(Object.keys(TYPE_CONFIG) as MemoryEntry['type'][]).map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filterType === t ? TYPE_CONFIG[t].activePill : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {TYPE_CONFIG[t].label}
            </button>
          ))}
        </div>

        {/* Agent dropdown */}
        {agents.length > 0 && (
          <div className="relative">
            <select
              value={filterAgent}
              onChange={(e) => setFilterAgent(e.target.value)}
              className="appearance-none bg-zinc-900 border border-zinc-800 text-sm rounded-lg px-4 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-300"
            >
              <option value="all">All Agents</option>
              {agents.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-zinc-500">
              <ChevronDown className="size-3.5" />
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative flex-1 min-w-[240px]">
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-zinc-500">
            <Search className="size-4" />
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search memories..."
            className="w-full bg-zinc-900 border border-zinc-800 text-sm rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-100 placeholder:text-zinc-500"
          />
        </div>
      </div>

      {/* Entries grouped by date */}
      <div className="space-y-12">
        {filtered.length === 0 && (
          <p className="text-sm text-zinc-500">No entries found.</p>
        )}
        {filtered.map((day) => {
          const dayIsToday = isToday(day.date)
          const relative = getRelativeDate(day.date)

          return (
            <section key={day.date}>
              {/* Date divider */}
              <div className="flex items-center gap-3 mb-6">
                {dayIsToday ? (
                  <>
                    <span className="text-[10px] font-bold tracking-[0.2em] text-blue-500 uppercase">Today</span>
                    <span className="text-xs text-zinc-600">{formatDateLabel(day.date)}</span>
                  </>
                ) : (
                  <>
                    <span className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">
                      {formatDateLabel(day.date)}
                    </span>
                    {relative && (
                      <span className="text-xs text-zinc-700">{relative}</span>
                    )}
                  </>
                )}
                <div className="h-[1px] flex-1 bg-zinc-900" />
              </div>

              {/* Entry cards */}
              <div className={`space-y-4 ${!dayIsToday ? 'opacity-80 hover:opacity-100 transition-opacity' : ''}`}>
                {day.entries.map((entry, i) => {
                  const cfg = TYPE_CONFIG[entry.type]
                  const displayText = stripPrefix(entry.text)

                  return (
                    <div
                      key={i}
                      className={`group relative flex flex-col bg-zinc-900/30 border border-zinc-800 rounded-xl p-5 hover:bg-zinc-900/50 transition-all border-l-[3px] ${cfg.border}`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${cfg.badge}`}>
                            {cfg.label}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm text-zinc-300 leading-relaxed">{displayText}</p>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
