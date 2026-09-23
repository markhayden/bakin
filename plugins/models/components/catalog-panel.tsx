'use client'

/**
 * The model catalog — the section at the foot of the Models page (spec
 * §3.4): every model the runtime lists with its eligibility verdict,
 * provider facets, search, sort, pagination, refresh and the explicit
 * (billed) availability probe. Read-only: model choices are made in the
 * lanes above, never from the catalog.
 */
import { useMemo, useState } from 'react'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { Section } from '@makinbakin/sdk/layout'
import { useQueryArrayState, useQueryState } from '@makinbakin/sdk/navigation'
import {
  DataTable,
  FacetFilter,
  PageControls,
  SearchInput,
  type DataTableColumn,
  type DataTableSort,
} from '@makinbakin/sdk/patterns'
import { Badge, Button, SystemState, Text } from '@makinbakin/sdk/ui'

import type { AvailableModel } from '../types'
import type { CatalogData } from './use-catalog'

/** Plain-words badge per eligibility reason (#907). */
const INELIGIBLE_LABEL: Record<NonNullable<Extract<AvailableModel['eligibility'], { status: 'ineligible' }>>['reason'], string> = {
  no_credentials: 'No credentials',
  account_rejected: 'Not available to your account',
  runtime_unavailable: 'Unavailable',
  not_in_catalog: 'Not in catalog',
}

const PAGE_SIZE = 8

/** Catalog sort keys — the union `DataTable` narrows `onSortChange` to. */
type ModelSortField = 'name' | 'provider' | 'tier' | 'contextWindow'

/** Capability order, not alphabetical: premium reads above standard above budget. */
const TIER_RANK: Record<string, number> = { premium: 0, standard: 1, budget: 2 }

function formatRelativeTime(ts: number | null): string {
  if (!ts) return 'never'
  const delta = Date.now() - ts
  const seconds = Math.max(0, Math.floor(delta / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function providerLabel(model: AvailableModel): string {
  return model.providerLabel ?? model.provider.replace(/[-_]/g, ' ')
}

function contextLabel(model: AvailableModel): string | null {
  if (model.contextWindowDisplay) return model.contextWindowDisplay
  if (!model.contextWindow) return null
  return `${Math.round(model.contextWindow / 1_000).toLocaleString()}K`
}

/**
 * Sort key for the context column. A curated model can carry a DISPLAY value
 * ("2M") with no numeric `contextWindow`; sorting on the raw field alone sank
 * those rows to the bottom in both directions while showing a real figure.
 */
function contextSortValue(model: AvailableModel): number | null {
  if (typeof model.contextWindow === 'number' && model.contextWindow > 0) return model.contextWindow
  const display = model.contextWindowDisplay
  if (!display) return null
  const match = /^\s*([\d.]+)\s*([KMB])?/i.exec(display)
  if (!match) return null
  const value = Number.parseFloat(match[1]!)
  if (!Number.isFinite(value)) return null
  const scale = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }[(match[2] ?? '').toLowerCase()] ?? 1
  return value * scale
}

function modelMatchesQuery(model: AvailableModel, query: string): boolean {
  if (!query) return true
  const searchable = [
    model.name,
    model.id,
    providerLabel(model),
    model.description,
    model.bestFor,
    model.input,
    model.tier,
    ...(model.tags ?? []),
  ].filter(Boolean).join(' ').toLocaleLowerCase()
  return searchable.includes(query)
}

/** Sort key per column; `null` sorts last regardless of direction. */
function sortValue(model: AvailableModel, field: ModelSortField): string | number | null {
  if (field === 'name') return model.name.toLocaleLowerCase()
  if (field === 'provider') return providerLabel(model).toLocaleLowerCase()
  if (field === 'tier') return TIER_RANK[model.tier] ?? Number.MAX_SAFE_INTEGER
  return contextSortValue(model)
}

export interface CatalogPanelProps {
  catalog: CatalogData
  /** The runtime's current default model — badged in the Status column. */
  defaultModel: string | null
}

export function CatalogPanel({ catalog, defaultModel }: CatalogPanelProps) {
  const {
    availableProviders,
    handleRefresh,
    handleVerify,
    verifying,
    probeVerdicts,
    availableModels: modelOptions,
    modelsCached,
    modelsCachedAt,
    modelsError,
    modelsLoaded,
    modelsStale,
    refreshing,
  } = catalog
  const effectiveDefaultModel = defaultModel ?? ''
  // Catalog view state rides the URL (shareable filters), omitted at default.
  const [query, setQuery] = useQueryState('modelQuery', '')
  const [providers, setProviders] = useQueryArrayState('modelProviders')
  const [pageValue, onPageChange] = useQueryState('modelPage', '1')
  const [showAllValue, onShowAllChange] = useQueryState('modelAll', 'false')
  const onQueryChange = (next: string) => {
    setQuery(next)
    onPageChange('1')
    onShowAllChange('false')
  }
  const onProvidersChange = (next: string[]) => setProviders(next)

  // Catalog order is the runtime's until the reader asks for another one —
  // the consumer owns ordering (DataTable contract).
  const [sort, setSort] = useState<DataTableSort<ModelSortField> | null>(null)

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const providerCounts = useMemo(() => Object.fromEntries(
    availableProviders.map((provider) => [
      provider,
      modelOptions.filter((model) => model.provider === provider).length,
    ]),
  ), [availableProviders, modelOptions])
  const providerOptions = useMemo(() => availableProviders.map((provider) => {
    const representative = modelOptions.find((model) => model.provider === provider)
    return { value: provider, label: representative ? providerLabel(representative) : provider }
  }), [availableProviders, modelOptions])
  const filteredModels = useMemo(() => modelOptions.filter((model) => (
    (providers.length === 0 || providers.includes(model.provider))
    && modelMatchesQuery(model, normalizedQuery)
  )), [modelOptions, normalizedQuery, providers])
  const sortedModels = useMemo(() => {
    if (!sort) return filteredModels
    const { field, dir } = sort
    return [...filteredModels].sort((a, b) => {
      const av = sortValue(a, field)
      const bv = sortValue(b, field)
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return dir === 'asc' ? cmp : -cmp
    })
  }, [filteredModels, sort])

  const parsedPage = Number.parseInt(pageValue, 10)
  const requestedPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const pageCount = Math.max(1, Math.ceil(sortedModels.length / PAGE_SIZE))
  const page = Math.min(requestedPage, pageCount)
  const showAll = showAllValue === 'true'
  const visibleModels = showAll
    ? sortedModels
    : sortedModels.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const resetPaging = () => {
    onPageChange('1')
    onShowAllChange('false')
  }
  const setProviderFilters = (nextProviders: string[]) => {
    onProvidersChange(nextProviders)
    resetPaging()
  }
  const clearFilters = () => {
    onQueryChange('')
    onProvidersChange([])
    resetPaging()
  }

  const columns: ReadonlyArray<DataTableColumn<AvailableModel, ModelSortField>> = [
    {
      key: 'name',
      header: 'Model',
      sortable: true,
      cellClassName: 'whitespace-normal',
      cell: (model) => (
        <div className="flex min-w-0 items-start">
          <div className="grid min-w-0 gap-bakin-1">
            <span className="min-w-0 break-words font-bakin-typography-weight-semibold text-bakin-text-primary">
              {model.name}
            </span>
            <Text size="meta" tone="muted" mono className="min-w-0 break-words">
              {model.id}
            </Text>
            {model.description ? (
              <Text size="meta" tone="muted" className="line-clamp-1 min-w-0 leading-relaxed">
                {model.description}
              </Text>
            ) : null}
            {model.bestFor ? (
              <Text size="meta" tone="muted" className="min-w-0 break-words">
                Best for: {model.bestFor}
              </Text>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: 'provider',
      header: 'Provider',
      sortable: true,
      cell: (model) => <span className="capitalize text-bakin-text-primary">{providerLabel(model)}</span>,
    },
    {
      key: 'tier',
      header: 'Tier',
      sortable: true,
      cell: (model) => <span className="capitalize text-bakin-text-muted">{model.tier}</span>,
    },
    {
      key: 'contextWindow',
      header: 'Context window',
      sortable: true,
      align: 'end',
      cell: (model) => <span className="tabular-nums text-bakin-text-muted">{contextLabel(model) ?? '—'}</span>,
    },
    {
      key: 'costRange',
      header: 'Cost range',
      cell: (model) => <span className="text-bakin-text-muted">{model.costRange ?? '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (model) => {
        // The persisted selection decides — the cached catalog row's own flag
        // goes stale the moment the default changes.
        const isDefault = model.id === effectiveDefaultModel
        return (
          <span className="flex flex-wrap items-center gap-bakin-1">
            {model.eligibility?.status === 'ineligible' ? (
              // #907 (subsumes #852): the row stays LISTED with the true
              // reason — no credentials for the provider, rejected by the
              // account, runtime-unavailable, or gone from the catalog.
              <Badge
                tone="danger"
                variant="soft"
                size="xs"
                title={model.rejection
                  ? `The provider refused this model for your credentials ${model.rejection.occurrences}× (last ${formatRelativeTime(model.rejection.lastSeenAt)}) — usually a plan or key that doesn't include it. Nothing to fix here: it clears on its own the next time a call succeeds, and Verify availability re-checks it now.`
                  : model.eligibility.detail}
              >
                {INELIGIBLE_LABEL[model.eligibility.reason]}
              </Badge>
            ) : model.eligibility?.status === 'unknown' ? (
              <Badge tone="neutral" variant="outline" size="xs" title={model.eligibility.detail}>Unverified</Badge>
            ) : null}
            {isDefault ? (
              <Badge tone="success" variant="soft" size="xs">Default</Badge>
            ) : model.configured ? (
              <Badge tone="neutral" variant="soft" size="xs">Configured</Badge>
            ) : null}
            {model.local ? <Badge tone="neutral" variant="soft" size="xs">Local</Badge> : null}
          </span>
        )
      },
    },
  ]

  const state = !modelsLoaded || (refreshing && modelOptions.length === 0) ? (
    <SystemState
      kind="loading"
      title="Loading available models"
      description="Asking the runtime which models are ready to use."
    />
  ) : modelOptions.length === 0 && modelsError ? (
    <SystemState
      kind="error"
      title="Models could not be loaded"
      description={modelsError}
      action={(
        <Button type="button" variant="outline" size="sm" onClick={handleRefresh} busy={refreshing}>
          <RefreshCw />
          Retry
        </Button>
      )}
    />
  ) : modelOptions.length === 0 ? (
    <SystemState
      kind="initial-empty"
      title="No models are available"
      description="The connected runtime did not report any usable models."
      action={(
        <Button type="button" variant="outline" size="sm" onClick={handleRefresh} busy={refreshing}>
          <RefreshCw />
          Refresh catalog
        </Button>
      )}
    />
  ) : filteredModels.length === 0 ? (
    <SystemState
      kind="no-results"
      title="No models match this view"
      description="Clear the current search and provider filters to return to the full catalog."
      action={<Button type="button" variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>}
    />
  ) : undefined

  return (
    <Section spacing="compact" divider="top" aria-labelledby="model-catalog-heading" data-testid="model-catalog">
      <div className="flex min-w-0 flex-wrap items-center gap-bakin-2">
        <h2 id="model-catalog-heading" className="m-0">Model catalog</h2>
        {modelsLoaded ? <Badge tone="neutral" variant="soft" size="xs">{modelOptions.length} model{modelOptions.length === 1 ? '' : 's'}</Badge> : null}
      </div>
      <Text as="p" size="meta" tone="muted" className="max-w-prose leading-relaxed">
        Every model your runtime reports, with whether it can run here. Choices are made in the lanes above — this list is for looking things up.
      </Text>
      <PageControls
        variant="filters"
        label="Model catalog controls"
        actions={(
          <>
            {modelsLoaded && modelsCachedAt ? (
              <Text size="meta" tone="muted">
                Refreshed {formatRelativeTime(modelsCachedAt)}
                {modelsCached ? ' · cached' : ''}
                {modelsStale ? ' · stale' : ''}
              </Text>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleRefresh}
              busy={refreshing}
            >
              <RefreshCw />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleVerify}
              busy={verifying}
              title="Fire a tiny billed probe per model to confirm your account can actually call it (#852). Explicit only — never runs on a schedule."
            >
              <ShieldCheck />
              {verifying ? 'Verifying…' : 'Verify availability'}
            </Button>
          </>
        )}
      >
        <FacetFilter
          label="Provider"
          options={providerOptions}
          selected={providers}
          onChange={setProviderFilters}
          counts={providerCounts}
        />
        <SearchInput
          align="end"
          label="Search the model catalog"
          value={query}
          onValueChange={onQueryChange}
          placeholder="Search models…"
        />
      </PageControls>

      {probeVerdicts ? (
        <Text size="meta" tone="muted">
          {`Availability verified: ${probeVerdicts.filter((v) => v.status === 'verified').length} callable · ${probeVerdicts.filter((v) => v.status === 'rejected').length} rejected · ${probeVerdicts.filter((v) => v.status === 'skipped').length} skipped`}
        </Text>
      ) : null}

      {/* Comparable catalog records read as a table (the tasks-Log ruling):
          columns, alignment, and sortable identity/provider/tier/context. */}
      {state ?? (
        <DataTable
          label="Available models"
          columns={columns}
          rows={visibleModels}
          rowKey={(model) => model.id}
          rowProps={(model) => ({
            'data-model-row': '',
            'data-default': model.id === effectiveDefaultModel ? 'true' : undefined,
          })}
          sort={sort ?? undefined}
          onSortChange={(field) => {
            setSort((prev) => prev?.field === field
              ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
              : { field, dir: field === 'contextWindow' ? 'desc' : 'asc' })
            onPageChange('1')
          }}
          pagination={{
            ariaLabel: 'Available model pagination',
            page,
            pageSize: PAGE_SIZE,
            showAll,
            total: sortedModels.length,
            onPageChange: (nextPage) => onPageChange(String(nextPage)),
            onShowAllChange: (nextShowAll) => {
              onShowAllChange(String(nextShowAll))
              onPageChange('1')
            },
          }}
        />
      )}
    </Section>
  )
}
