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
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  ClipboardList,
  MessagesSquare,
  CornerDownRight,
  Bookmark,
  Calendar,
  Database,
  Moon,
  User,
  UserCircle,
  Scroll,
  Wrench,
  Fingerprint,
  HeartPulse,
  Brain,
  NotebookText,
  Play,
  Sparkles,
  Microscope,
  Eraser,
} from 'lucide-react'
import {
  AgentAvatar,
  AgentFilter,
  FacetFilter,
  ListPage,
  ListPageContent,
  ListPageControls,
  Pagination,
  PageHeader,
  SearchInput,
  SearchUnavailable,
  type AgentIdentity,
  type AgentFilterOption,
  type FacetOption,
} from '@makinbakin/sdk/patterns'
import { useQueryArrayState, useQueryState } from '@makinbakin/sdk/navigation'
import { Badge, Banner, Button, Switch } from '@makinbakin/sdk/ui'
import { useAgentList, useSearch, type SearchResult } from '@makinbakin/sdk/hooks'
import { TierOverviewCards } from './tier-overview-cards'
import { MemorySearchResults } from './memory-search-results'
import { MemoryDetailDrawer } from './memory-detail-drawer'
import { useRecordDeepLink } from './use-record-deep-link'
import { MemoryCleanup } from './memory-cleanup'

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

// Durable sub-tier "kind" buckets. Values match the normalized mapping in
// `plugins/memory/lib/durable-kinds.ts:DURABLE_KIND_BY_BASENAME` plus
// `skill` from the skill indexer. Labels mirror the team-detail tab names
// so `kind=soul` on /memory lines up with the SOUL tab on /team/<id>.
const KIND_OPTIONS: FacetOption[] = [
  { value: 'soul', label: 'Soul', icon: <UserCircle className="size-3.5" /> },
  { value: 'rules', label: 'Rules', icon: <Scroll className="size-3.5" /> },
  { value: 'tools', label: 'Tools', icon: <Wrench className="size-3.5" /> },
  { value: 'skill', label: 'Skills', icon: <Sparkles className="size-3.5" /> },
  { value: 'identity', label: 'Identity', icon: <Fingerprint className="size-3.5" /> },
  { value: 'heartbeat', label: 'Heartbeat', icon: <HeartPulse className="size-3.5" /> },
  { value: 'memory', label: 'Memory', icon: <Brain className="size-3.5" /> },
  { value: 'memory-log', label: 'Memory Log', icon: <NotebookText className="size-3.5" /> },
  { value: 'dreams', label: 'Dreams (file)', icon: <Moon className="size-3.5" /> },
  { value: 'user', label: 'User', icon: <User className="size-3.5" /> },
  { value: 'bootstrap', label: 'Bootstrap', icon: <Play className="size-3.5" /> },
]

function useRecentFeed(
  enabled: boolean,
  tiers: string[],
  agent: string,
  kinds: string[],
  debug: boolean,
): { results: SearchResult[]; loading: boolean; error: string | null } {
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Serialize deps as a primitive so the effect doesn't fire on every
  // parent render when the array refs change.
  const tierKey = tiers.slice().sort().join(',')
  const agentKey = agent
  const kindKey = kinds.slice().sort().join(',')

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
    if (kindKey) params.set('kind', kindKey)
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
  }, [enabled, tierKey, agentKey, kindKey, debug])

  return { results, loading, error }
}

function MemoryShellInner() {
  const [query, setQuery] = useQueryState('q', '')
  const [tiers, setTiers] = useQueryArrayState('tier')
  const [agent, setAgent] = useQueryState('agent', '')
  const [kinds, setKinds] = useQueryArrayState('kind')
  const [debugParam, setDebugParam] = useQueryState('debug', '')
  const [mode, setMode] = useQueryState('mode', '')
  const [pageParam, setPageParam] = useQueryState('memoryPage', '1')
  const cleanupMode = mode === 'cleanup'
  const debug = debugParam === '1'

  const searchActive = query.trim().length > 0

  // The Kind facet only makes sense under the durable tier (it discriminates
  // SOUL vs TOOLS vs skill, etc.). Showing it while sessions/turns/audits are
  // in the feed would attach a filter that silently matches nothing.
  const kindFacetVisible = tiers.length === 1 && tiers[0] === 'durable'

  // limit=20 is the ceiling we can run cheaply — the reranker is per-doc
  // and turn content is up to 32 KB, so bumping to 100 pushed latency to
  // 30s. When Debug is off and every top-20 hit is turn/audit, the client
  // renders a targeted empty state pointing the user at the Debug toggle.
  const {
    results: searchResults,
    aggregations,
    status: searchStatus,
    loading: searchLoading,
    error: searchError,
    search,
    clear,
    retry,
  } = useSearch({
    plugin: 'memory',
    facets: ['tier', 'agent', 'kind'],
    debounce: 250,
  })

  // Engine-down is an explicit state (spec D11): render the honest
  // SearchUnavailable panel, never a misleading "no results" empty state.
  const searchUnavailable = searchActive && searchStatus === 'unavailable'

  const { results: recentResults, loading: recentLoading, error: recentError } = useRecentFeed(
    !searchActive,
    tiers,
    agent,
    kinds,
    debug,
  )

  useEffect(() => {
    if (searchActive) search(query)
    else clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // If the user switches tier away from just-durable, drop any selected
  // kind filters — they become invisible (facet is hidden) and would
  // silently zero out the feed otherwise.
  useEffect(() => {
    if (!kindFacetVisible && kinds.length > 0) setKinds([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindFacetVisible])

  const sourceResults = searchActive ? searchResults : recentResults
  const loading = searchActive ? searchLoading : recentLoading
  const error = searchActive ? searchError : recentError

  // ?recordId= drives the detail drawer (⌘K deep links, refresh, back
  // button). List clicks route through the same param via record.open();
  // deep links always resolve via /record (source of truth), never from
  // on-screen index copies.
  const record = useRecordDeepLink()

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
      if (agent && String(r.fields.agent) !== agent) return false
      if (kinds.length) {
        const k = r.fields.kind
        if (typeof k !== 'string' || !kinds.includes(k)) return false
      }
      return true
    })
  }, [sourceResults, tiers, agent, kinds, debug])

  // True when the server returned hits but the Debug filter stripped them
  // all — a targeted empty state points the user at the toggle rather than
  // making them guess why "workflow" returned nothing.
  const hiddenByDebug = searchActive && !debug && sourceResults.length > 0 && filtered.length === 0

  const pageSize = 8
  const showAll = pageParam === 'all'
  const requestedPage = Number.parseInt(pageParam, 10)
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const page = Number.isFinite(requestedPage)
    ? Math.min(Math.max(requestedPage, 1), pageCount)
    : 1
  const visibleResults = showAll
    ? filtered
    : filtered.slice((page - 1) * pageSize, page * pageSize)

  const resultViewKey = [
    query,
    tiers.slice().sort().join(','),
    agent,
    kinds.slice().sort().join(','),
    debug ? 'debug' : 'standard',
  ].join('|')
  const previousResultViewKey = useRef(resultViewKey)
  useEffect(() => {
    if (previousResultViewKey.current === resultViewKey) return
    previousResultViewKey.current = resultViewKey
    setPageParam('1')
  }, [resultViewKey, setPageParam])

  // When debug is off, hide turn/audit options — UNLESS one is already
  // selected via URL (bookmarked link, browser-back, etc.). Otherwise the
  // chip stays active but invisible with no way to remove it.
  const tierOptions = useMemo(() => {
    if (debug) return ALL_TIER_OPTIONS
    return ALL_TIER_OPTIONS.filter(
      (o) => !DEBUG_ONLY_TIERS.has(o.value) || tiers.includes(o.value),
    )
  }, [debug, tiers])

  // Roster-backed so every known agent appears in the filter even if they
  // have nothing indexed yet. Aggregation values outside the roster (retired
  // agents, renamed ids) are surfaced at the end so the filter still reaches
  // every row present in search.
  const roster = useAgentList()

  const agentIds = useMemo(() => {
    const seen = new Set<string>()
    const ids: string[] = []
    for (const a of roster) {
      if (seen.has(a.id)) continue
      seen.add(a.id)
      ids.push(a.id)
    }
    for (const a of aggregations?.agent ?? []) {
      if (seen.has(a.value)) continue
      seen.add(a.value)
      ids.push(a.value)
    }
    return ids
  }, [roster, aggregations])

  const agentOptions = useMemo<AgentFilterOption[]>(() => {
    const rosterById = new Map(roster.map((item) => [item.id, item]))
    return agentIds.map((id) => {
      const item = rosterById.get(id)
      const label = item?.name || id
      return {
        value: id,
        label,
        visual: (
          <AgentAvatar
            agent={{
              id,
              name: label,
              imageSrc: item?.headshot || null,
            }}
            size="sm"
            decorative
          />
        ),
      }
    })
  }, [agentIds, roster])

  const resultAgents = useMemo<AgentIdentity[]>(
    () => roster.map((item) => ({
      id: item.id,
      name: item.name || item.id,
      imageSrc: item.headshot || null,
    })),
    [roster],
  )

  const tierCounts = useMemo(() => {
    const agg = aggregations?.tier ?? []
    return Object.fromEntries(agg.map((a) => [a.value, a.count]))
  }, [aggregations])

  const kindCounts = useMemo(() => {
    const agg = aggregations?.kind ?? []
    return Object.fromEntries(agg.map((a) => [a.value, a.count]))
  }, [aggregations])

  // Surface aggregation-only kinds (unknown buckets from forward-compat
  // additions) so filtering still reaches them even if KIND_OPTIONS is out
  // of date. Static options render first in their curated order; unknowns
  // append at the end with a generic icon.
  const kindOptions: FacetOption[] = useMemo(() => {
    const seen = new Set(KIND_OPTIONS.map((o) => o.value))
    const extras: FacetOption[] = []
    for (const a of aggregations?.kind ?? []) {
      if (seen.has(a.value)) continue
      extras.push({ value: a.value, label: a.value, icon: <Database className="size-3.5" /> })
    }
    return [...KIND_OPTIONS, ...extras]
  }, [aggregations])

  const recordFeedback = record.error ? (
    <Banner
      tone="danger"
      title="That memory record could not be opened"
      description={`${record.error}${searchActive ? ' Showing the closest matches below.' : ''}`}
      action={<Button variant="outline" size="sm" onClick={record.close}>Dismiss</Button>}
      data-testid="memory-record-error"
    />
  ) : undefined

  return (
    <ListPage className="h-full overflow-auto">
      <PageHeader
        title="Memory"
        description="Search what your agents remember, inspect saved context, and clean up stale or unnecessary records."
        meta={<Badge size="xs" variant="outline">{visibleResults.length} shown</Badge>}
        controlsLabel="Memory search"
        controls={(
          <SearchInput
            align="end"
            label="Memory search"
            value={query}
            onValueChange={setQuery}
            placeholder="Search memory…"
            busy={searchLoading}
            mobileFullWidth
          />
        )}
        actionsLabel="Memory actions"
        actions={(
          <Button
            variant={cleanupMode ? 'secondary' : 'outline'}
            onClick={() => setMode(cleanupMode ? '' : 'cleanup')}
          >
            <Eraser />
            {cleanupMode ? 'Close cleanup' : 'Cleanup'}
          </Button>
        )}
      />

      {cleanupMode ? (
        <ListPageContent label="Memory cleanup">
          <MemoryCleanup />
        </ListPageContent>
      ) : (
        <>
          <TierOverviewCards includeSystemLogs={debug} />

          <ListPageControls
            label="Memory filters"
            actions={(
              <div
                role="group"
                aria-label="System log visibility"
                className="flex h-bakin-8 select-none items-center gap-bakin-2 rounded-bakin-control px-bakin-2 font-bakin-typography-weight-semibold text-bakin-text-muted"
                title={debug ? 'Hide turns and audit records' : 'Include turns and audit records'}
              >
                <Microscope className="size-bakin-4" aria-hidden="true" />
                <span className="text-bakin-typography-size-body">System Logs</span>
                <Switch
                  checked={debug}
                  onCheckedChange={(checked: boolean) => setDebugParam(checked ? '1' : '')}
                  size="sm"
                  aria-label={debug ? 'Hide system logs' : 'Include system logs'}
                />
              </div>
            )}
          >
            <FacetFilter
              label="Tier"
              options={tierOptions}
              selected={tiers}
              onChange={setTiers}
              counts={tierCounts}
            />
            <AgentFilter
              options={agentOptions}
              value={agent || 'all'}
              onValueChange={(id) => setAgent(id === 'all' ? '' : id)}
              compact
            />
            {kindFacetVisible ? (
              <FacetFilter
                label="Kind"
                options={kindOptions}
                selected={kinds}
                onChange={setKinds}
                counts={kindCounts}
              />
            ) : null}
          </ListPageControls>

          <ListPageContent
            label="Memory results"
            busy={loading && filtered.length > 0}
            feedback={recordFeedback}
            state={searchUnavailable ? <SearchUnavailable retry={retry} scope="page" /> : undefined}
          >
            <MemorySearchResults
              results={visibleResults}
              agents={resultAgents}
              loading={loading}
              error={error}
              query={query}
              hiddenByDebug={hiddenByDebug}
              onEnableDebug={() => setDebugParam('1')}
              onClear={() => setQuery('')}
              onSelect={record.open}
            />
            <Pagination
              ariaLabel="Memory results pagination"
              page={page}
              pageSize={pageSize}
              showAll={showAll}
              total={filtered.length}
              onPageChange={(nextPage) => setPageParam(String(nextPage))}
              onShowAllChange={(nextShowAll) => setPageParam(nextShowAll ? 'all' : '1')}
            />
          </ListPageContent>

          <MemoryDetailDrawer
            result={record.row}
            agents={resultAgents}
            open={record.row !== null}
            onOpenChange={(open) => { if (!open) record.close() }}
          />
        </>
      )}
    </ListPage>
  )
}

export function MemoryShell() {
  return (
    <Suspense fallback={null}>
      <MemoryShellInner />
    </Suspense>
  )
}
