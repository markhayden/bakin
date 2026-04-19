'use client'

/**
 * MemoryShell — landing surface for /memory.
 *
 * Top: tier-overview cards (live row counts from /status).
 * Middle: search input + tier / agent facet filters (URL-backed).
 * Bottom: cross-tier results from the memory plugin's /search route.
 *
 * Filters are persisted in the URL via useQueryArrayState so the page is
 * bookmarkable and browser back/forward round-trip the view.
 */
import { Suspense, useEffect, useMemo } from 'react'
import {
  ClipboardList,
  MessagesSquare,
  CornerDownRight,
  Bookmark,
  Calendar,
  Database,
  Moon,
  User,
} from 'lucide-react'
import { PluginHeader } from '@/components/plugin-header'
import { FacetFilter, type FacetOption } from '@/components/facet-filter'
import { useSearch } from '@/hooks/use-search'
import { useQueryState, useQueryArrayState } from '@/hooks/use-query-state'
import { TierOverviewCards } from './tier-overview-cards'
import { MemorySearchResults } from './memory-search-results'

const TIER_OPTIONS: FacetOption[] = [
  { value: 'audit', label: 'Audit', icon: <ClipboardList className="size-3.5" /> },
  { value: 'session', label: 'Sessions', icon: <MessagesSquare className="size-3.5" /> },
  { value: 'turn', label: 'Turns', icon: <CornerDownRight className="size-3.5" /> },
  { value: 'checkpoint', label: 'Checkpoints', icon: <Bookmark className="size-3.5" /> },
  { value: 'daily_note', label: 'Daily Notes', icon: <Calendar className="size-3.5" /> },
  { value: 'durable', label: 'Durable', icon: <Database className="size-3.5" /> },
  { value: 'dream', label: 'Dreams', icon: <Moon className="size-3.5" /> },
]

function MemoryShellInner() {
  const [query, setQuery] = useQueryState('q', '')
  const [tiers, setTiers] = useQueryArrayState('tier')
  const [agents, setAgents] = useQueryArrayState('agent')

  const { results, aggregations, loading, error, search, clear } = useSearch({
    plugin: 'memory',
    facets: ['tier', 'agent'],
    debounce: 250,
  })

  useEffect(() => {
    if (query.trim()) search(query)
    else clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // Client-side post-filter by tier/agent. The server returns cross-tier
  // results already; faceting here is a dumb narrow because filtering by
  // tier is the highest-leverage user action.
  const filtered = useMemo(() => {
    if (!tiers.length && !agents.length) return results
    return results.filter((r) => {
      if (tiers.length && !tiers.includes(String(r.fields.tier))) return false
      if (agents.length && !agents.includes(String(r.fields.agent))) return false
      return true
    })
  }, [results, tiers, agents])

  const agentOptions: FacetOption[] = useMemo(() => {
    const agg = aggregations?.agent ?? []
    return agg.map((a) => ({
      value: a.value,
      label: a.value,
      icon: <User className="size-3.5" />,
    }))
  }, [aggregations])

  const tierCounts = useMemo(() => {
    const agg = aggregations?.tier ?? []
    return Object.fromEntries(agg.map((a) => [a.value, a.count]))
  }, [aggregations])

  const agentCounts = useMemo(() => {
    const agg = aggregations?.agent ?? []
    return Object.fromEntries(agg.map((a) => [a.value, a.count]))
  }, [aggregations])

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <PluginHeader
        title="Memory"
        count={filtered.length}
        search={{
          value: query,
          onChange: setQuery,
          placeholder: 'Search across every tier…',
        }}
      />

      <TierOverviewCards />

      <div className="flex items-center gap-2 flex-wrap">
        <FacetFilter
          label="Tier"
          options={TIER_OPTIONS}
          selected={tiers}
          onChange={setTiers}
          counts={tierCounts}
        />
        {agentOptions.length > 0 && (
          <FacetFilter
            label="Agent"
            options={agentOptions}
            selected={agents}
            onChange={setAgents}
            counts={agentCounts}
          />
        )}
      </div>

      <MemorySearchResults
        results={filtered}
        loading={loading}
        error={error}
        query={query}
      />
    </div>
  )
}

export function MemoryShell() {
  return (
    <Suspense fallback={null}>
      <MemoryShellInner />
    </Suspense>
  )
}
