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
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
} from 'lucide-react'
import {
  AgentAvatar,
  AgentFilter,
  FacetFilter,
  Page,
  PageBody,
  PageControls,
  Pagination,
  PageHeader,
  SearchInput,
  SearchUnavailable,
  type AgentIdentity,
  type AgentFilterOption,
  type FacetOption,
  type DataTableSort,
  SegmentedControl,
  type SegmentedControlOption,
} from '@makinbakin/sdk/patterns'
import { useQueryArrayState, useQueryState } from '@makinbakin/sdk/navigation'
import { Badge, Banner, Button, Field, FieldLabel, Switch } from '@makinbakin/sdk/ui'
import {
  useAgentList,
  usePluginJsonFetch,
  useSearch,
  type SearchResult,
} from '@makinbakin/sdk/hooks'
import { TierOverviewCards } from './tier-overview-cards'
import {
  MemorySearchResults,
  memorySortValue,
  type MemorySortField,
} from './memory-search-results'
import { MemoryDetailDrawer } from './memory-detail-drawer'
import { useRecordDeepLink } from './use-record-deep-link'
import { MemoryCleanup } from './memory-cleanup'

// Tiers hidden unless the page-local Debug toggle is on. See spec §Memory
// Debug View — turns are 12k+ per-message rows, audits are operational
// event logs; both swamp the "what's in memory" signal for everyday use.
const DEBUG_ONLY_TIERS = new Set(['turn', 'audit'])

const ALL_TIER_OPTIONS: FacetOption[] = [
  { value: 'session', label: 'Sessions', icon: <MessagesSquare className="size-bakin-4" /> },
  { value: 'checkpoint', label: 'Checkpoints', icon: <Bookmark className="size-bakin-4" /> },
  { value: 'daily_note', label: 'Daily Notes', icon: <Calendar className="size-bakin-4" /> },
  { value: 'durable', label: 'Durable', icon: <Database className="size-bakin-4" /> },
  { value: 'dream', label: 'Dreams', icon: <Moon className="size-bakin-4" /> },
  // Debug-only below.
  { value: 'turn', label: 'Turns', icon: <CornerDownRight className="size-bakin-4" /> },
  { value: 'audit', label: 'Audit', icon: <ClipboardList className="size-bakin-4" /> },
]

// Durable sub-tier "kind" buckets. Values match the normalized mapping in
// `plugins/memory/lib/durable-kinds.ts:DURABLE_KIND_BY_BASENAME` plus
// `skill` from the skill indexer. Labels mirror the team-detail tab names
// so `kind=soul` on /memory lines up with the SOUL tab on /team/<id>.
const KIND_OPTIONS: FacetOption[] = [
  { value: 'soul', label: 'Soul', icon: <UserCircle className="size-bakin-4" /> },
  { value: 'rules', label: 'Rules', icon: <Scroll className="size-bakin-4" /> },
  { value: 'tools', label: 'Tools', icon: <Wrench className="size-bakin-4" /> },
  { value: 'skill', label: 'Skills', icon: <Sparkles className="size-bakin-4" /> },
  { value: 'identity', label: 'Identity', icon: <Fingerprint className="size-bakin-4" /> },
  { value: 'heartbeat', label: 'Heartbeat', icon: <HeartPulse className="size-bakin-4" /> },
  { value: 'memory', label: 'Memory', icon: <Brain className="size-bakin-4" /> },
  { value: 'memory-log', label: 'Memory Log', icon: <NotebookText className="size-bakin-4" /> },
  { value: 'dreams', label: 'Dreams (file)', icon: <Moon className="size-bakin-4" /> },
  { value: 'user', label: 'User', icon: <User className="size-bakin-4" /> },
  { value: 'bootstrap', label: 'Bootstrap', icon: <Play className="size-bakin-4" /> },
]

function useRecentFeed(
  enabled: boolean,
  tiers: string[],
  agent: string,
  kinds: string[],
  debug: boolean,
): { results: SearchResult[]; loading: boolean; error: string | null } {
  // Serialize the array deps as primitives so the request path is stable
  // across parent renders that only change the array refs.
  const tierKey = tiers.slice().sort().join(',')
  const kindKey = kinds.slice().sort().join(',')

  // A null path parks the request: with a query active the recent feed is not
  // the source, and the hook reports no data rather than a stale one.
  const path = useMemo(() => {
    if (!enabled) return null
    const params = new URLSearchParams()
    params.set('limit', '30')
    if (tierKey) params.set('tier', tierKey)
    if (agent) params.set('agent', agent)
    if (kindKey) params.set('kind', kindKey)
    if (debug) params.set('debug', '1')
    return `recent?${params}`
  }, [enabled, tierKey, agent, kindKey, debug])

  // The feed scans the index, so it gets an explicit deadline instead of
  // spinning forever behind a stalled engine.
  const { data, loading, error } = usePluginJsonFetch<{ results: SearchResult[] }>(
    'memory',
    path,
    { timeoutMs: 15_000 },
  )

  const results = useMemo(() => data?.results ?? [], [data])
  return { results, loading, error }
}

const MEMORY_VIEWS: ReadonlyArray<SegmentedControlOption<'browse' | 'scrub'>> = [
  { value: 'browse', label: 'Browse' },
  { value: 'scrub', label: 'Scrub' },
]

function MemoryShellInner() {
  const [query, setQuery] = useQueryState('q', '')
  const [tiers, setTiers] = useQueryArrayState('tier')
  const [agent, setAgent] = useQueryState('agent', '')
  const [kinds, setKinds] = useQueryArrayState('kind')
  const [debugParam, setDebugParam] = useQueryState('debug', '')
  const [mode, setMode] = useQueryState('mode', '')
  const [pageParam, setPageParam] = useQueryState('memoryPage', '1')
  // 'browse' is the default view; 'scrub' is the find-and-remove workflow.
  // (The backing API routes are still named `cleanup` — this is UI language.)
  const scrubMode = mode === 'scrub'
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

  // Sort lives here, above the page slice: sorting inside the results table
  // would reorder only the visible page while announcing a global sort.
  const [sort, setSort] = useState<DataTableSort<MemorySortField> | null>(null)
  const sorted = useMemo(() => {
    if (!sort) return filtered
    const { field, dir } = sort
    return [...filtered].sort((a, b) => {
      const av = memorySortValue(a, field)
      const bv = memorySortValue(b, field)
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return dir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sort])

  const handleSortChange = useCallback((field: MemorySortField) => {
    setSort((prev) => prev?.field === field
      ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { field, dir: field === 'updated' ? 'desc' : 'asc' })
  }, [])

  // Memory rows are dense one-liners; 8 forced paging almost immediately.
  const pageSize = 25
  const showAll = pageParam === 'all'
  const requestedPage = Number.parseInt(pageParam, 10)
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const page = Number.isFinite(requestedPage)
    ? Math.min(Math.max(requestedPage, 1), pageCount)
    : 1
  const visibleResults = showAll
    ? sorted
    : sorted.slice((page - 1) * pageSize, page * pageSize)

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
      extras.push({ value: a.value, label: a.value, icon: <Database className="size-bakin-4" /> })
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
    <Page>
      <PageHeader
        title="Memory"
        description="Search what your agents remember, inspect saved context, and clean up stale or unnecessary records."
        // Both belong to Browse: Scrub has its own find field, and a row count
        // for a list it isn't showing is just noise.
        meta={scrubMode ? undefined : <Badge size="xs" variant="outline">{visibleResults.length} shown</Badge>}
        controlsLabel="Memory search"
        controls={scrubMode ? undefined : (
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
        actionsLabel="Memory views"
        actions={(
          <SegmentedControl
            options={MEMORY_VIEWS}
            value={scrubMode ? 'scrub' : 'browse'}
            onValueChange={(next) => setMode(next === 'scrub' ? 'scrub' : '')}
            ariaLabel="Memory view"
            idPrefix="memory-view"
          />
        )}
      />

      {scrubMode ? (
        <PageBody label="Memory scrub">
          <MemoryCleanup />
        </PageBody>
      ) : (
        <>
          <TierOverviewCards includeSystemLogs={debug} />

          <PageControls
            label="Memory filters"
            actions={(
              <Field orientation="horizontal" name="systemLogs" className="h-bakin-8 px-bakin-2">
                <Switch
                  checked={debug}
                  onCheckedChange={(checked: boolean) => setDebugParam(checked ? '1' : '')}
                  size="sm"
                />
                <FieldLabel>
                  <Microscope className="size-bakin-4" aria-hidden="true" />
                  System Logs
                </FieldLabel>
              </Field>
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
          </PageControls>

          <PageBody
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
              sort={sort}
              onSortChange={handleSortChange}
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
          </PageBody>

          <MemoryDetailDrawer
            result={record.row}
            agents={resultAgents}
            open={record.row !== null}
            onOpenChange={(open) => { if (!open) record.close() }}
          />
        </>
      )}
    </Page>
  )
}

export function MemoryShell() {
  return (
    <Suspense fallback={null}>
      <MemoryShellInner />
    </Suspense>
  )
}
