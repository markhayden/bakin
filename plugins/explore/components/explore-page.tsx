import { Suspense, useMemo, useState } from 'react'
import { Compass, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { PluginHeader, EmptyState, ErrorBanner, FacetFilter, UnderlineTabs } from '@makinbakin/sdk/components'
import { useJsonFetch, useQueryState, useQueryArrayState } from '@makinbakin/sdk/hooks'
import { Button } from '@makinbakin/sdk/ui'
import { CatalogCard } from './catalog-card'
import { DetailDrawer } from './detail-drawer'
import { InstallDialog } from './install-dialog'
import type { ExploreCatalogEntry, ExploreCatalogResponse } from '../types'

const PACK_KINDS = new Set(['skill-pack', 'workflow-pack', 'lesson-pack'])

function tabOf(entry: ExploreCatalogEntry): 'agents' | 'plugins' | 'packs' {
  if (entry.kind === 'agent') return 'agents'
  if (entry.kind === 'plugin') return 'plugins'
  return 'packs'
}

function ExplorePageInner() {
  const { data, loading, error, refresh } = useJsonFetch<ExploreCatalogResponse>('/api/plugins/explore/catalog')
  const [tab, setTab] = useQueryState('tab', 'agents')
  const [categories, setCategories] = useQueryArrayState('category')
  const [selectedKey, setSelectedKey] = useQueryState('item')
  const [installOpen, setInstallOpen] = useState(false)
  const [installEntry, setInstallEntry] = useState<ExploreCatalogEntry | null>(null)
  // Probe/refresh responses carry state the base GET can't reproduce
  // (agent update probes are never persisted) — they override until the
  // next base refetch.
  const [override, setOverride] = useState<ExploreCatalogResponse | null>(null)
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
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  const entries = useMemo(() => override?.entries ?? data?.entries ?? [], [override, data])
  const hasPacks = entries.some((entry) => PACK_KINDS.has(entry.kind))

  const tabs = useMemo(() => {
    const base = [
      { id: 'agents', label: 'Agents' },
      { id: 'plugins', label: 'Plugins' },
    ]
    return hasPacks ? [...base, { id: 'packs', label: 'Packs' }] : base
  }, [hasPacks])

  const tabEntries = useMemo(
    () => entries.filter((entry) => tabOf(entry) === tab),
    [entries, tab],
  )

  const categoryOptions = useMemo(() => {
    const seen = [...new Set(tabEntries.map((entry) => entry.category))].sort()
    return seen.map((category) => ({ value: category, label: category }))
  }, [tabEntries])

  const visible = useMemo(
    () => (categories.length === 0
      ? tabEntries
      : tabEntries.filter((entry) => categories.includes(entry.category))),
    [tabEntries, categories],
  )

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
        title="Explore"
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

      <div className="flex flex-wrap items-center gap-3">
        <UnderlineTabs
          tabs={tabs}
          value={tab}
          onValueChange={(id) => {
            setTab(id)
            setCategories([])
          }}
        />
        <FacetFilter
          label="Category"
          options={categoryOptions}
          selected={categories}
          onChange={setCategories}
        />
      </div>

      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <EmptyState
          icon={Compass}
          title="Nothing here yet"
          description={categories.length > 0
            ? 'No entries match the selected categories.'
            : 'The catalog has no entries for this tab yet.'}
        />
      )}

      {!loading && visible.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((entry) => (
            <CatalogCard
              key={`${entry.kind}:${entry.id}`}
              entry={entry}
              onSelect={(selectedEntry) => setSelectedKey(`${selectedEntry.kind}:${selectedEntry.id}`)}
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
