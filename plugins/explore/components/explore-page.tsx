import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Compass, Plus, RefreshCw, Search, Sparkles } from 'lucide-react'
import { PluginHeader, EmptyState, ErrorBanner, FacetFilter, UnderlineTabs } from '@makinbakin/sdk/components'
import { toast, useJsonFetch, useQueryState, useQueryArrayState } from '@makinbakin/sdk/hooks'
import { Button, Input } from '@makinbakin/sdk/ui'
import { CatalogCard } from './catalog-card'
import { DetailDrawer } from './detail-drawer'
import { HubSkillsTab } from './hub-skills-tab'
import { InstallDialog } from './install-dialog'
import type { ExploreCatalogEntry, ExploreCatalogResponse } from '../types'

function tabOf(entry: ExploreCatalogEntry): 'agents' | 'plugins' | 'lessons' | 'capabilities' | 'packs' {
  if (entry.kind === 'agent') return 'agents'
  if (entry.kind === 'plugin') return 'plugins'
  if (entry.kind === 'lesson-pack') return 'lessons'
  if (entry.kind === 'skill-pack' && entry.capability) return 'capabilities'
  return 'packs'
}

/**
 * Section intros — most users are meeting agents, plugins, and lessons for
 * the first time. Each tab explains what its items are and why they exist.
 */
const TAB_INTROS: Record<string, { title: string; blurb: string }> = {
  agents: {
    title: 'Hire your team',
    blurb:
      'Agents are ready-made teammates — each ships with an identity, skills, and a job it’s great at. ' +
      'Install one and it shows up on your Team page, ready for work. Official agents are maintained by Bakin and safe to try.',
  },
  plugins: {
    title: 'Extend the platform',
    blurb:
      'Plugins add whole new capabilities to Bakin — new pages, tools your agents can use, and automations. ' +
      'Built-in ones are already part of your install; the rest are one click away and activate without a restart.',
  },
  lessons: {
    title: 'Level up your agents',
    blurb:
      'Lessons teach the agents you already have — domain knowledge, house style, sharper judgment. ' +
      'Install a lesson pack here, then enable individual lessons per agent from their Team page.',
  },
  capabilities: {
    title: 'Teach your agents new tricks',
    blurb:
      'Capabilities give your agents real-world powers — web search, browser automation, transcription. ' +
      'Install one and Bakin handles everything: the skill content, any pinned binaries, and a guided step ' +
      'for the API key it needs. Works with any runtime unless badged otherwise.',
  },
  packs: {
    title: 'Reusable building blocks',
    blurb:
      'Skill and workflow packs bundle proven processes you can drop into your own automations — ' +
      'install once, reuse everywhere.',
  },
  skills: {
    title: 'Bring skills from anywhere',
    blurb:
      'The wider ecosystem — ClawHub, Pi, Anthropic — shares one skill format, and Bakin installs it ' +
      'onto whichever runtime you run. Browse a hub in your browser, paste the link here, review the ' +
      'trust preview, done. Versions are pinned and hub-flagged malware is refused outright.',
  },
}

function ExplorePageInner() {
  const { data, loading, error, refresh } = useJsonFetch<ExploreCatalogResponse>('/api/plugins/explore/catalog')
  const [tab, setTab] = useQueryState('tab', 'agents')
  const [categories, setCategories] = useQueryArrayState('category')
  const [selectedKey, setSelectedKey] = useQueryState('item')
  const [query, setQuery] = useQueryState('q')
  // Filtering reads the local draft for instant feedback; only the URL
  // write is debounced (same reason PluginHeader's search debounces —
  // the param is for deep-linking, keystrokes aren't).
  const [searchDraft, setSearchDraft] = useState(query)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current) }, [])
  // Resync the draft when the URL param changes underneath us (sidebar
  // re-click clears ?q=, back/forward, shared links) — otherwise the grid
  // stays filtered by text the URL no longer claims. A pending debounced
  // commit converges to the same value, so this never fights typing.
  useEffect(() => {
    setSearchDraft(query)
    if (searchTimer.current) clearTimeout(searchTimer.current)
  }, [query])
  const onSearchChange = (value: string) => {
    setSearchDraft(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setQuery(value), 200)
  }
  const [installOpen, setInstallOpen] = useState(false)
  const [installEntry, setInstallEntry] = useState<ExploreCatalogEntry | null>(null)
  // Probe/refresh responses carry state the base GET can't reproduce
  // (agent update probes are never persisted) — they override until the
  // next base refetch delivers, then the fresher base data wins.
  const [override, setOverride] = useState<ExploreCatalogResponse | null>(null)
  useEffect(() => {
    setOverride(null)
  }, [data])
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<'check' | 'refresh' | null>(null)

  const runAction = async (action: 'check' | 'refresh') => {
    setBusyAction(action)
    setActionError(null)
    try {
      const res = action === 'check'
        ? await fetch('/api/plugins/explore/catalog?check=1')
        : await fetch('/api/plugins/explore/catalog/refresh', { method: 'POST' })
      const body = (await res.json()) as ExploreCatalogResponse & { ok: boolean; error?: string; reason?: string }
      if (!res.ok || !body.ok) {
        setActionError(body.error ?? `HTTP ${res.status}`)
        return
      }
      setOverride(body)
      if (action === 'check') {
        const updates = body.entries.filter((entry) => entry.updateAvailable === true)
        const failed = body.probeErrors ?? 0
        if (updates.length > 0) {
          const suffix = failed > 0 ? ` (${failed} couldn't be checked)` : ''
          toast(`${updates.length} update${updates.length === 1 ? '' : 's'} available: ${updates.map((u) => u.name).join(', ')}${suffix}`, 'success')
        } else if (failed > 0) {
          toast(`Couldn't check ${failed} item${failed === 1 ? '' : 's'} — network or source unreachable. Everything that could be checked is up to date.`, 'error')
        } else {
          toast('Everything is up to date.', 'success')
        }
      } else {
        toast(
          body.remoteUpdatedAt
            ? `Catalog refreshed — remote version from ${body.remoteUpdatedAt.slice(0, 10)}.`
            : 'Catalog refreshed.',
          'success',
        )
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  const entries = useMemo(() => override?.entries ?? data?.entries ?? [], [override, data])
  // Lessons are a first-class section even while the catalog has none —
  // the intro/empty state teaches users what lessons are. Skill/workflow
  // packs stay hidden until content exists.
  const hasPacks = entries.some((entry) => tabOf(entry) === 'packs')

  const tabs = useMemo(() => {
    const base = [
      { id: 'agents', label: 'Agents' },
      { id: 'plugins', label: 'Plugins' },
      { id: 'capabilities', label: 'Capabilities' },
      { id: 'lessons', label: 'Lessons' },
      { id: 'skills', label: 'Hub Skills' },
    ]
    return hasPacks ? [...base, { id: 'packs', label: 'Packs' }] : base
  }, [hasPacks])

  const tabEntries = useMemo(
    () => entries
      .filter((entry) => tabOf(entry) === tab)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [entries, tab],
  )

  const categoryOptions = useMemo(() => {
    const seen = [...new Set(tabEntries.map((entry) => entry.category))].sort()
    return seen.map((category) => ({ value: category, label: category }))
  }, [tabEntries])

  // Only apply category selections that exist on the current tab — a
  // selection made on another tab stays in the URL but never filters this
  // one down to nothing. (Also avoids a setTab+setCategories double URL
  // write, where the second setter clobbers the first from stale params.)
  const activeCategories = useMemo(
    () => categories.filter((category) => tabEntries.some((entry) => entry.category === category)),
    [categories, tabEntries],
  )

  const visible = useMemo(() => {
    const byCategory = activeCategories.length === 0
      ? tabEntries
      : tabEntries.filter((entry) => activeCategories.includes(entry.category))
    const needle = searchDraft.trim().toLowerCase()
    if (!needle) return byCategory
    return byCategory.filter((entry) =>
      [entry.name, entry.description, entry.category, ...entry.tags, ...entry.useCases]
        .some((haystack) => haystack.toLowerCase().includes(needle)),
    )
  }, [tabEntries, activeCategories, searchDraft])

  const selected = useMemo(
    () => entries.find((entry) => `${entry.kind}:${entry.id}` === selectedKey) ?? null,
    [entries, selectedKey],
  )

  const installedPluginIds = useMemo(
    () => new Set(entries.filter((entry) => entry.kind === 'plugin' && entry.installed).map((entry) => entry.id)),
    [entries],
  )

  return (
    <div className="p-6 flex flex-col flex-1 gap-6">
      <PluginHeader
        title="Extend Bakin"
        count={entries.length}
        subtitle="Do more with Bakin — official agents, plugins, and packs"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              data-testid="refresh-catalog"
              disabled={busyAction !== null}
              onClick={() => runAction('refresh')}
              title="Fetch the latest official catalog from GitHub"
            >
              <RefreshCw className={`mr-1.5 size-3.5 ${busyAction === 'refresh' ? 'animate-spin' : ''}`} />
              Refresh catalog
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="check-updates"
              disabled={busyAction !== null}
              onClick={() => runAction('check')}
              title="Probe installed plugins and agents for available updates"
            >
              <Sparkles className="mr-1.5 size-3.5" />
              {busyAction === 'check' ? 'Checking…' : 'Check for updates'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="install-from-source"
              onClick={() => {
                setInstallEntry(null)
                setInstallOpen(true)
              }}
            >
              <Plus className="mr-1.5 size-3.5" />
              Install from source…
            </Button>
          </div>
        }
      />

      {error && <ErrorBanner message={error} onRetry={refresh} />}
      {actionError && <ErrorBanner message={actionError} onRetry={() => setActionError(null)} />}

      <div
        data-testid="explore-banner"
        className="relative flex min-h-32 flex-col justify-center overflow-hidden rounded-2xl border border-pink-500/20 bg-gradient-to-r from-pink-500/25 via-fuchsia-500/15 to-amber-400/20 px-8 py-6"
      >
        <span className="text-lg font-semibold text-foreground">Make Bakin yours</span>
        <span className="max-w-xl text-sm text-foreground/70">
          Hire agents, bolt on plugins, and teach your team new tricks — everything here is official, curated, and one click away.
        </span>
      </div>

      {/* Toolbar: search + facets left, section tabs right (matches the
          filter-row convention of the other plugin pages). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Grows on focus so there's room to type; collapses back on blur. */}
          <div className="relative w-64 transition-[width] duration-200 ease-out focus-within:w-[36rem] max-w-full">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="explore-search"
              value={searchDraft}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search agents, plugins, lessons…"
              className="h-8 w-full pl-8 text-sm"
            />
          </div>
          <FacetFilter
            label="Category"
            options={categoryOptions}
            selected={categories}
            onChange={setCategories}
          />
        </div>
        <UnderlineTabs
          tabs={tabs}
          value={tab}
          onValueChange={setTab}
        />
      </div>

      {TAB_INTROS[tab] && (
        <div data-testid="tab-intro" className="max-w-3xl">
          <h2 className="text-sm font-semibold text-foreground">{TAB_INTROS[tab].title}</h2>
          <p className="text-sm text-muted-foreground">{TAB_INTROS[tab].blurb}</p>
        </div>
      )}

      {/* Hub Skills is a live-state surface (#687), not a catalog grid. */}
      {tab === 'skills' && <HubSkillsTab />}

      {tab !== 'skills' && loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      )}

      {tab !== 'skills' && !loading && !error && visible.length === 0 && (
        <EmptyState
          icon={Compass}
          title={searchDraft.trim()
            ? 'No matches'
            : tab === 'lessons' ? 'Lesson packs are coming'
              : tab === 'capabilities' ? 'Capability packs are coming' : 'Nothing here yet'}
          description={searchDraft.trim()
            ? `Nothing on this tab matches "${searchDraft.trim()}" — try another tab or clear the search.`
            : activeCategories.length > 0
              ? 'No entries match the selected categories.'
              : tab === 'lessons'
                ? 'Official lesson packs will appear here as they\'re published. Agents you install often ship their own lessons — manage those from the agent\'s Team page.'
                : 'The catalog has no entries for this tab yet.'}
        />
      )}

      {tab !== 'skills' && !loading && visible.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((entry) => (
            <CatalogCard
              key={`${entry.kind}:${entry.id}`}
              entry={entry}
              activeAdapter={data?.activeAdapter}
              onSelect={(selectedEntry) => setSelectedKey(`${selectedEntry.kind}:${selectedEntry.id}`)}
              onInstall={(installTarget) => {
                setInstallEntry(installTarget)
                setInstallOpen(true)
              }}
            />
          ))}
        </div>
      )}

      <DetailDrawer
        entry={selected}
        installedPluginIds={installedPluginIds}
        onOpenChange={(open) => {
          if (!open) setSelectedKey('')
        }}
        actions={
          selected && !selected.builtin && !selected.installed ? (
            <Button
              data-testid="drawer-install"
              onClick={() => {
                setInstallEntry(selected)
                setInstallOpen(true)
              }}
            >
              Install
            </Button>
          ) : undefined
        }
      />

      <InstallDialog
        open={installOpen}
        onOpenChange={setInstallOpen}
        entry={installEntry}
        onInstalled={() => {
          setSelectedKey('')
          setOverride(null)
          refresh()
        }}
      />
    </div>
  )
}

export function ExplorePage() {
  return (
    <Suspense fallback={null}>
      <ExplorePageInner />
    </Suspense>
  )
}
