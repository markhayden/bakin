import { Suspense, useMemo, useState } from 'react'
import { Compass, Plus } from 'lucide-react'
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

  const entries = useMemo(() => data?.entries ?? [], [data])
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
        }
      />

      {error && <ErrorBanner message={error} onRetry={refresh} />}

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
