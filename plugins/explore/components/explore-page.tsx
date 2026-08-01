import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { Grid } from '@makinbakin/sdk/layout'
import { useQueryArrayState, useQueryState } from '@makinbakin/sdk/navigation'
import {
  FacetFilter,
  Page,
  PageBody,
  PageControls,
  PageHeader,
  SearchInput,
} from '@makinbakin/sdk/patterns'
import {
  Badge,
  Banner,
  Button,
  Card,
  CardContent,
  CardHeader,
  Skeleton,
  SystemState,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@makinbakin/sdk/ui'
import { toast, useJsonFetch } from '@makinbakin/sdk/hooks'
import { CatalogCard } from './catalog-card'
import { DetailDrawer } from './detail-drawer'
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
}

const CATALOG_GRID_CLASSES = '@xl/page-shell:grid-cols-2 @3xl/page-shell:grid-cols-3 @5xl/page-shell:grid-cols-4'

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
  const catalogState = override ?? data
  const filtered = searchDraft.trim().length > 0 || activeCategories.length > 0
  const clearFilters = () => {
    onSearchChange('')
    setQuery('')
    setCategories([])
  }
  const maintenanceActions = (
    <>
      <Button
        variant="outline"
        size="sm"
        data-testid="refresh-catalog"
        disabled={busyAction !== null}
        onClick={() => void runAction('refresh')}
        title="Fetch the latest official catalog from GitHub"
      >
        <RefreshCw className={busyAction === 'refresh' ? 'animate-spin' : undefined} />
        Refresh catalog
      </Button>
      <Button
        variant="outline"
        size="sm"
        data-testid="check-updates"
        disabled={busyAction !== null}
        onClick={() => void runAction('check')}
        title="Probe installed plugins and agents for available updates"
      >
        <Sparkles />
        {busyAction === 'check' ? 'Checking…' : 'Check for updates'}
      </Button>
    </>
  )
  const resultState = error ? (
    <SystemState
      kind="error"
      scope="page"
      title="The catalog could not be loaded"
      description={error}
      action={<Button variant="outline" onClick={refresh}>Try again</Button>}
    />
  ) : loading ? (
    <SystemState
      kind="loading"
      scope="page"
      title="Loading the catalog"
      description="Official agents, plugins, lessons, and capabilities will appear here."
      preview={(
        <Grid layout="single" gap="item" className={CATALOG_GRID_CLASSES}>
          {Array.from({ length: 6 }, (_, index) => (
            <Card key={index} size="sm">
              <CardHeader>
                <div className="flex min-w-0 items-center gap-bakin-3">
                  <Skeleton shape="circle" className="size-bakin-8" />
                  <Skeleton shape="text" className="min-w-0 flex-1" />
                </div>
              </CardHeader>
              <CardContent className="grid gap-bakin-2">
                <Skeleton shape="text" />
                <Skeleton shape="text" className="w-2/3" />
              </CardContent>
            </Card>
          ))}
        </Grid>
      )}
    />
  ) : visible.length === 0 ? (
    <SystemState
      kind={filtered ? 'no-results' : 'initial-empty'}
      scope="page"
      title={filtered
        ? 'No catalog items match'
        : tab === 'lessons' ? 'Lesson packs are coming'
          : tab === 'capabilities' ? 'Capability packs are coming' : 'Nothing here yet'}
      description={filtered
        ? 'Clear the current search and category filters, or browse another section.'
        : tab === 'lessons'
          ? 'Official lesson packs will appear here as they are published. Installed agents can also include lessons you manage from Team.'
          : 'The official catalog has no entries for this section yet.'}
      {...(filtered
        ? { action: <Button variant="outline" onClick={clearFilters}>Clear search and filters</Button> }
        : {})}
    />
  ) : undefined

  return (
    <Page>
      <PageHeader
        title="Explore"
        description="Find and install official agents, plugins, lessons, and capabilities to extend your Bakin workspace."
        meta={catalogState ? <Badge size="xs" variant="outline">{entries.length} available</Badge> : undefined}
        controlsLabel="Catalog search"
        controls={(
          <SearchInput
            align="end"
            label="Catalog search"
            value={searchDraft}
            onValueChange={onSearchChange}
            placeholder="Search the catalog…"
            mobileFullWidth
            className="@3xl/page-header:w-[22rem] @3xl/page-header:shrink-0"
          />
        )}
        actionsLabel="Catalog actions"
        actions={(
          <Button
            data-testid="install-from-source"
            onClick={() => {
              setInstallEntry(null)
              setInstallOpen(true)
            }}
          >
            <Plus />
            Install from source
          </Button>
        )}
      />

      <Tabs value={tab} onValueChange={(value) => setTab(value as string)}>
        <TabsList variant="underline" activateOnFocus aria-label="Catalog sections">
          {tabs.map((item) => (
            <TabsTrigger
              key={item.id}
              value={item.id}
              id={`explore-tab-${item.id}`}
              aria-controls={`explore-panel-${item.id}`}
            >
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <PageControls
        label="Catalog filters and maintenance"
        className="border-t-0 pt-0"
        actions={maintenanceActions}
      >
        {categoryOptions.length > 0 ? (
          <FacetFilter
            label="Category"
            options={categoryOptions}
            selected={categories}
            onChange={setCategories}
          />
        ) : <span className="text-bakin-typography-size-meta text-bakin-text-muted">No categories in this section</span>}
      </PageControls>

      <PageBody
        label="Catalog results"
        busy={busyAction !== null}
        feedback={actionError ? (
          <Banner
            tone="danger"
            title="The catalog action could not be completed"
            description={actionError}
            action={<Button variant="outline" size="sm" onClick={() => setActionError(null)}>Dismiss</Button>}
          />
        ) : undefined}
        state={resultState}
      >
        {TAB_INTROS[tab] ? (
          <section data-testid="tab-intro" className="grid max-w-3xl gap-bakin-1">
            <h2 className="m-0 text-bakin-typography-size-section-title font-bakin-typography-weight-semibold text-bakin-text-primary">
              {TAB_INTROS[tab].title}
            </h2>
            <p className="m-0 text-bakin-typography-size-body leading-relaxed text-bakin-text-muted">
              {TAB_INTROS[tab].blurb}
            </p>
          </section>
        ) : null}

        <Grid layout="single" gap="item" className={CATALOG_GRID_CLASSES}>
          {visible.map((entry) => (
            <CatalogCard
              key={`${entry.kind}:${entry.id}`}
              entry={entry}
              activeAdapter={catalogState?.activeAdapter}
              onSelect={(selectedEntry) => setSelectedKey(`${selectedEntry.kind}:${selectedEntry.id}`)}
              onInstall={(installTarget) => {
                setInstallEntry(installTarget)
                setInstallOpen(true)
              }}
            />
          ))}
        </Grid>
      </PageBody>

      <DetailDrawer
        entry={selected}
        installedPluginIds={installedPluginIds}
        onOpenChange={(open) => {
          if (!open) setSelectedKey('')
        }}
        actions={
          selected && !selected.builtin
            ? selected.installed
              ? (
                  <Button
                    data-testid="drawer-installed"
                    size="xs"
                    variant="primary"
                    disabled
                  >
                    <Check />
                    Installed
                  </Button>
                )
              : (
                  <Button
                    data-testid="drawer-install"
                    size="xs"
                    variant="primary"
                    onClick={() => {
                      setInstallEntry(selected)
                      setInstallOpen(true)
                    }}
                  >
                    <Plus />
                    Install
                  </Button>
                )
            : undefined
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
    </Page>
  )
}

export function ExplorePage() {
  return (
    <Suspense fallback={null}>
      <ExplorePageInner />
    </Suspense>
  )
}
