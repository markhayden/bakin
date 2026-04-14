'use client'

import { useState, useEffect, useMemo } from 'react'
import { useContentStore } from '@/hooks/use-content-store'
import { useAgentIds } from '@bakin/team/hooks/use-agent-store'
import { useSearch, type SearchResult } from '@/hooks/use-search'
import { useDebug } from '@/hooks/use-debug'
import { useQueryState } from '@/hooks/use-query-state'
import { AgentFilter } from '@/components/agent-filter'
import { TimelineEntry } from './timeline-entry'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search } from 'lucide-react'
import type { AuditEntry } from '../types'

interface ScoreInfo {
  score: number
  indexScores?: Record<string, number>
}

/**
 * Build a score map keyed by audit entry timestamp. Audit rows in Antfly are
 * keyed as `audit-${ts}-${event}` (see plugins/memory/index.ts reindex), so
 * we recover the `ts` either from the indexed doc fields (`created_at`) or by
 * stripping the `audit-` prefix and the trailing `-${event}` segment off the
 * search result id. The fields-first path keeps the test fixtures (which
 * pass a raw ts as `id` and an empty `fields` object) working too.
 */
function buildAuditScoreMap(results: SearchResult[]): Map<string, ScoreInfo> {
  const map = new Map<string, ScoreInfo>()
  for (const r of results) {
    const info: ScoreInfo = { score: r.score, indexScores: r.indexScores }
    const created = r.fields?.created_at
    if (typeof created === 'string') {
      map.set(created, info)
    }
    // Also key by the raw id — covers both legacy callers and the
    // `audit-${ts}-${event}` case where we can recover ts by stripping.
    map.set(r.id, info)
    if (r.id.startsWith('audit-')) {
      const event = r.fields?.event
      const stripped = typeof event === 'string'
        ? r.id.slice('audit-'.length, r.id.length - (event.length + 1))
        : r.id.slice('audit-'.length)
      if (stripped) map.set(stripped, info)
    }
  }
  return map
}

const EVENT_TYPES = [
  { value: '', label: 'All events' },
  { value: 'task.*', label: 'Tasks' },
  { value: 'agent.*', label: 'Agents' },
  { value: 'system.*', label: 'System' },
]

export function AuditTimeline() {
  const agentIds = useAgentIds()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [agentFilter, setAgentFilter] = useQueryState('agent', 'all')
  const [eventFilter, setEventFilter] = useQueryState('event', '')
  const [search, setSearch] = useQueryState('q', '')
  const searchHook = useSearch({ plugin: 'memory', facets: ['event', 'agent'], debounce: 300 })
  const [debug] = useDebug()
  useEffect(() => {
    if (search) searchHook.search(search)
    else searchHook.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])
  const auditEntries = useContentStore((s) => s.auditEntries)

  // Score map shared by the relevance reorder AND the debug-mode score overlay.
  const scoreMap = useMemo(
    () => buildAuditScoreMap(searchHook.results),
    [searchHook.results],
  )

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

    if (agentFilter && agentFilter !== 'all') {
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
      if (searchHook.results.length) {
        return result
          .filter(e => scoreMap.has(e.ts))
          .sort((a, b) => (scoreMap.get(b.ts)?.score ?? 0) - (scoreMap.get(a.ts)?.score ?? 0))
      }
      // While Antfly is in flight we keep the full agent/event-filtered list
      // visible instead of flashing "no matches" during the 300ms debounce
      // window. Once loading settles with still no hits, fall through to the
      // newest-first sort so the user sees everything that passed the
      // non-search filters.
      if (searchHook.loading) return result
    }

    // Newest-first when not searching
    return [...result].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
  }, [allEntries, agentFilter, eventFilter, search, searchHook.results, searchHook.loading, scoreMap])

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
        <div className="ml-auto">
          <AgentFilter agentIds={agentIds} value={agentFilter} onChange={setAgentFilter} showIcon={false} />
        </div>
      </div>

      <div className="flex flex-col divide-y divide-border">
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">No audit entries found.</p>
        )}
        {filtered.map((entry, i) => {
          const scoreInfo = scoreMap.get(entry.ts)
          const showScores = debug && !!search?.trim() && !!scoreInfo
          const semKey = 'embeddings'
          const bm25Key = scoreInfo?.indexScores
            ? Object.keys(scoreInfo.indexScores).find(k => k !== semKey)
            : undefined
          return (
            <div key={`${entry.ts}-${i}`} className="relative">
              <TimelineEntry entry={entry} />
              {showScores && scoreInfo && (
                <div className="absolute top-2 right-2 flex items-center gap-2 font-mono text-[10px] bg-black/70 px-1.5 py-0.5 rounded pointer-events-none">
                  <span className="text-amber-400">RRF {scoreInfo.score.toFixed(3)}</span>
                  <span className="text-cyan-400">
                    BM25 {(bm25Key ? scoreInfo.indexScores?.[bm25Key] ?? 0 : 0).toFixed(3)}
                  </span>
                  <span className="text-purple-400">
                    SEM {(scoreInfo.indexScores?.[semKey] ?? 0).toFixed(3)}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
