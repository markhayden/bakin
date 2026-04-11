'use client'

import { useState, useEffect, useMemo } from 'react'
import { useContentStore } from '@/hooks/use-content-store'
import { useAgentList } from '@bakin/team/hooks/use-agent-store'
import { useAntflySearch } from '@/hooks/use-antfly-search'
import { TimelineEntry } from './timeline-entry'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search } from 'lucide-react'
import type { AuditEntry } from '../types'

const EVENT_TYPES = [
  { value: '', label: 'All events' },
  { value: 'task.*', label: 'Tasks' },
  { value: 'agent.*', label: 'Agents' },
  { value: 'system.*', label: 'System' },
]

export function AuditTimeline() {
  const agents = useAgentList()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [agentFilter, setAgentFilter] = useState('')
  const [eventFilter, setEventFilter] = useState('')
  const [search, setSearch] = useState('')
  const antfly = useAntflySearch({ table: 'audit', facets: ['event', 'agent'], debounce: 300 })
  useEffect(() => {
    if (search) antfly.search(search)
    else antfly.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])
  const auditEntries = useContentStore((s) => s.auditEntries)

  // Fetch full audit log on mount
  useEffect(() => {
    fetch('/api/plugins/memory/audit')
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((data) => setEntries(data.entries || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Merge SSE entries — keep sorted newest-first
  const allEntries = useMemo(() => {
    if (auditEntries.length === 0) return entries
    const existingTs = new Set(entries.map((e) => e.ts))
    const newOnes = auditEntries.filter((e) => !existingTs.has(e.ts))
    return [...newOnes, ...entries] // new SSE entries at top
  }, [entries, auditEntries])

  const filtered = useMemo(() => {
    let result = allEntries

    if (agentFilter) {
      result = result.filter((e) => e.agent === agentFilter)
    }

    if (eventFilter) {
      if (eventFilter.endsWith('.*')) {
        const prefix = eventFilter.slice(0, -2)
        result = result.filter((e) => e.event.startsWith(prefix + '.'))
      } else {
        result = result.filter((e) => e.event === eventFilter)
      }
    }

    if (search) {
      if (antfly.results.length) {
        const matchIds = new Set(antfly.results.map(r => r.id))
        result = result.filter(e => matchIds.has(e.ts))
      } else {
        const q = search.toLowerCase()
        result = result.filter(
          (e) =>
            e.event.toLowerCase().includes(q) ||
            JSON.stringify(e.data).toLowerCase().includes(q)
        )
      }
    }

    // Already newest-first (API returns reversed, SSE prepended) — sort to be safe
    return [...result].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
  }, [allEntries, agentFilter, eventFilter, search])

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading audit log...</p>
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events..."
            className="pl-9 h-8 bg-surface border-border"
          />
        </div>
        <div className="flex items-center gap-1">
          {EVENT_TYPES.map((et) => (
            <Button
              key={et.value}
              variant={eventFilter === et.value ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setEventFilter(et.value)}
            >
              {et.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <Button
            variant={agentFilter === '' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setAgentFilter('')}
          >
            All
          </Button>
          {agents.map((a) => (
            <Button
              key={a.id}
              variant={agentFilter === a.id ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setAgentFilter(a.id)}
              title={a.name}
            >
              {a.emoji}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col divide-y divide-border">
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">No audit entries found.</p>
        )}
        {filtered.map((entry, i) => (
          <TimelineEntry key={`${entry.ts}-${i}`} entry={entry} />
        ))}
      </div>
    </div>
  )
}
