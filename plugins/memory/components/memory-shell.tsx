'use client'

/**
 * MemoryShell — landing surface for /memory.
 *
 * Top: tier-overview cards (live row counts from /status).
 * Middle: search input + tier / agent facet filters (URL-backed).
 * Bottom: cross-tier results — either a /recent feed (no query) or
 *         cross-tier search results (query active).
 *
 * `?debug=1` is a page-local toggle (separate from the global useDebug())
 * that opts into the noisy tiers — turns (per-message detail) and audits
 * (operational event stream). Both are hidden by default because they're
 * high-volume, low-signal for "what does this agent remember"; they stay
 * one click away for when you're debugging.
 *
 * All state (query, tiers, agents, debug) is URL-backed so the page is
 * bookmarkable and browser back/forward round-trip the view.
 */
import { Suspense, useEffect, useMemo, useState } from 'react'
import {
  ClipboardList,
  MessagesSquare,
  CornerDownRight,
  Bookmark,
  Calendar,
  Database,
  Moon,
  User,
  ListFilter,
  Microscope,
} from 'lucide-react'
import { PluginHeader } from '@/components/plugin-header'
import { FacetFilter, type FacetOption } from '@/components/facet-filter'
import { Switch } from '@/components/ui/switch'
import { useSearch, type SearchResult } from '@/hooks/use-search'
import { useQueryState, useQueryArrayState } from '@/hooks/use-query-state'
import { TierOverviewCards } from './tier-overview-cards'
import { MemorySearchResults } from './memory-search-results'
import { MemoryDetailDrawer } from './memory-detail-drawer'

// Tiers hidden unless the page-local Debug toggle is on. See spec §Memory
// Debug View — turns are 12k+ per-message rows, audits are operational
// event logs; both swamp the "what's in memory" signal for everyday use.
const DEBUG_ONLY_TIERS = new Set(['turn', 'audit'])

const ALL_TIER_OPTIONS: FacetOption[] = [
  { value: 'session', label: 'Sessions', icon: <MessagesSquare className="size-3.5" /> },
  { value: 'checkpoint', label: 'Checkpoints', icon: <Bookmark className="size-3.5" /> },
  { value: 'daily_note', label: 'Daily Notes', icon: <Calendar className="size-3.5" /> },
  { value: 'durable', label: 'Durable', icon: <Database className="size-3.5" /> },
  { value: 'dream', label: 'Dreams', icon: <Moon className="size-3.5" /> },
  // Debug-only below.
  { value: 'turn', label: 'Turns', icon: <CornerDownRight className="size-3.5" /> },
  { value: 'audit', label: 'Audit', icon: <ClipboardList className="size-3.5" /> },
]

function useRecentFeed(
  enabled: boolean,
  tiers: string[],
  agents: string[],
  debug: boolean,
): { results: SearchResult[]; loading: boolean; error: string | null } {
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Serialize deps as a primitive so the effect doesn't fire on every
  // parent render when the array refs change.
  const tierKey = tiers.slice().sort().join(',')
  const agentKey = agents.slice().sort().join(',')

  useEffect(() => {
    if (!enabled) {
      setResults([])
      setError(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    const params = new URLSearchParams()
    params.set('limit', '30')
    if (tierKey) params.set('tier', tierKey)
    if (agentKey) params.set('agent', agentKey)
    if (debug) params.set('debug', '1')

    fetch(`/api/plugins/memory/recent?${params}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`recent: ${res.status}`)
        return res.json() as Promise<{ results: SearchResult[] }>
      })
      .then((data) => {
        setResults(data.results ?? [])
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => controller.abort()
  }, [enabled, tierKey, agentKey, debug])

  return { results, loading, error }
}

function MemoryShellInner() {
  const [query, setQuery] = useQueryState('q', '')
  const [tiers, setTiers] = useQueryArrayState('tier')
  const [agents, setAgents] = useQueryArrayState('agent')
  const [debugParam, setDebugParam] = useQueryState('debug', '')
  const debug = debugParam === '1'
  const [selected, setSelected] = useState<SearchResult | null>(null)

  const searchActive = query.trim().length > 0

  // limit=20 is the ceiling we can run cheaply — the reranker is per-doc
  // and turn content is up to 32 KB, so bumping to 100 pushed latency to
  // 30s. When Debug is off and every top-20 hit is turn/audit, the client
  // renders a targeted empty state pointing the user at the Debug toggle.
  const { results: searchResults, aggregations, loading: searchLoading, error: searchError, search, clear } = useSearch({
    plugin: 'memory',
    facets: ['tier', 'agent'],
    debounce: 250,
  })

  const { results: recentResults, loading: recentLoading, error: recentError } = useRecentFeed(
    !searchActive,
    tiers,
    agents,
    debug,
  )

  useEffect(() => {
    if (searchActive) search(query)
    else clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const sourceResults = searchActive ? searchResults : recentResults
  const loading = searchActive ? searchLoading : recentLoading
  const error = searchActive ? searchError : recentError

  // Client-side post-filter. When Debug is off we normally strip turn+audit
  // (they drown out everything else), BUT an explicit tier chip is an opt-in
  // override — a user who bookmarked `?tier=turn` with debug off should see
  // turns, not an empty list with no hint why. The tier-chip filter itself
  // runs right below and narrows further.
  const filtered = useMemo(() => {
    return sourceResults.filter((r) => {
      const tier = String(r.fields.tier)
      if (!debug && DEBUG_ONLY_TIERS.has(tier) && !tiers.includes(tier)) return false
      if (tiers.length && !tiers.includes(tier)) return false
      if (agents.length && !agents.includes(String(r.fields.agent))) return false
      return true
    })
  }, [sourceResults, tiers, agents, debug])

  // True when the server returned hits but the Debug filter stripped them
  // all — a targeted empty state points the user at the toggle rather than
  // making them guess why "workflow" returned nothing.
  const hiddenByDebug = searchActive && !debug && sourceResults.length > 0 && filtered.length === 0

  // When debug is off, hide turn/audit options — UNLESS one is already
  // selected via URL (bookmarked link, browser-back, etc.). Otherwise the
  // chip stays active but invisible with no way to remove it.
  const tierOptions = useMemo(() => {
    if (debug) return ALL_TIER_OPTIONS
    return ALL_TIER_OPTIONS.filter(
      (o) => !DEBUG_ONLY_TIERS.has(o.value) || tiers.includes(o.value),
    )
  }, [debug, tiers])

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
        actions={
          <label
            className="flex items-center gap-2 px-2 h-8 rounded-md text-xs cursor-pointer select-none hover:bg-accent/50 transition-colors"
            title={debug ? 'Hide turns + audit' : 'Include turns + audit'}
          >
            <Microscope className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">System Logs</span>
            <Switch
              checked={debug}
              onCheckedChange={(checked: boolean) => setDebugParam(checked ? '1' : '')}
              size="sm"
            />
          </label>
        }
      />

      <TierOverviewCards />

      <div className="flex items-center gap-3 flex-wrap">
        <ListFilter className="size-3.5 text-muted-foreground shrink-0" />
        <FacetFilter
          label="Tier"
          options={tierOptions}
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
        hiddenByDebug={hiddenByDebug}
        onEnableDebug={() => setDebugParam('1')}
        onSelect={(r) => setSelected(r)}
      />

      <MemoryDetailDrawer
        result={selected}
        open={selected !== null}
        onOpenChange={(open) => { if (!open) setSelected(null) }}
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
