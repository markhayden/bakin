'use client'

import { useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  FacetFilter,
  ListPageContent,
  ListPageControls,
  Pagination,
} from '@makinbakin/sdk/patterns'
import { Badge, Button, SystemState } from '@makinbakin/sdk/ui'

import type { AvailableModel } from '../types'
import { BrandIcon } from './brand-icon'
import type { ModelsData } from './use-models-data'

const PAGE_SIZE = 8

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

function ModelRow({
  defaultModel,
  model,
  saving,
  setAsDefault,
}: {
  defaultModel: string
  model: AvailableModel
  saving: boolean
  setAsDefault: (modelId: string) => Promise<void>
}) {
  const isDefault = model.isDefault || model.id === defaultModel
  const context = model.contextWindowDisplay
    ?? (model.contextWindow ? `${Math.round(model.contextWindow / 1_000).toLocaleString()}K context` : null)

  return (
    <li>
      <div
        data-model-row
        data-default={isDefault || undefined}
        aria-current={isDefault ? 'true' : undefined}
        className={`grid min-w-0 gap-bakin-3 rounded-bakin-surface border px-bakin-4 py-bakin-4 transition-[background-color,border-color,box-shadow] duration-[var(--bakin-motion-duration-feedback)] motion-reduce:transition-none @lg/page-shell:grid-cols-[minmax(0,1fr)_auto] @lg/page-shell:items-center ${
          isDefault
            ? 'border-bakin-action-primary-background/60 bg-bakin-action-primary-background/10 ring-1 ring-bakin-action-primary-background/40'
            : 'border-bakin-border-subtle/30 bg-bakin-surface-default hover:border-bakin-border-subtle'
        }`}
      >
        <div className="flex min-w-0 items-start gap-bakin-3">
          <BrandIcon
            slug={model.brandIconSlug ?? model.providerBrandIconSlug}
            fallbackText={providerLabel(model)}
            fallbackColor={model.providerBrandColor}
            size="md"
            className="mt-bakin-1"
          />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-bakin-2 gap-y-bakin-1">
              <strong className="min-w-0 truncate text-bakin-text-primary">{model.name}</strong>
              {isDefault ? (
                <Badge tone="success" variant="solid" size="xs">Default</Badge>
              ) : model.configured ? (
                <Badge tone="neutral" variant="solid" size="xs">Configured</Badge>
              ) : null}
              {model.local ? <Badge tone="neutral" variant="solid" size="xs">Local</Badge> : null}
            </div>
            <p className="m-0 mt-bakin-1 truncate font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
              {model.id}
            </p>
            {model.description ? (
              <p className="m-0 mt-bakin-2 line-clamp-2 text-bakin-typography-size-meta leading-relaxed text-bakin-text-muted">
                {model.description}
              </p>
            ) : null}
            <div className="mt-bakin-2 flex min-w-0 flex-wrap items-center gap-x-bakin-3 gap-y-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">
              <span className="capitalize text-bakin-text-primary">{providerLabel(model)}</span>
              <span className="capitalize">{model.tier}</span>
              {context ? <span>{context}</span> : null}
              {model.costRange ? <span>{model.costRange}</span> : null}
              {model.bestFor ? <span>Best for: {model.bestFor}</span> : null}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-start @lg/page-shell:justify-end">
          {!isDefault ? (
            <Button
              type="button"
              size="xs"
              disabled={saving}
              onClick={() => void setAsDefault(model.id)}
            >
              Set default
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  )
}

export interface AvailableModelsTabProps {
  m: ModelsData
  query: string
  providers: string[]
  pageValue: string
  showAllValue: string
  onQueryChange: (query: string) => void
  onProvidersChange: (providers: string[]) => void
  onPageChange: (page: string) => void
  onShowAllChange: (showAll: string) => void
}

export function AvailableModelsTab({
  m,
  query,
  providers,
  pageValue,
  showAllValue,
  onQueryChange,
  onProvidersChange,
  onPageChange,
  onShowAllChange,
}: AvailableModelsTabProps) {
  const {
    availableProviders,
    effectiveDefaultModel,
    handleRefresh,
    modelOptions,
    modelsCached,
    modelsCachedAt,
    modelsError,
    modelsLoaded,
    modelsStale,
    refreshing,
    saving,
    setAsDefault,
  } = m

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const providerCounts = useMemo(() => Object.fromEntries(
    availableProviders.map((provider) => [
      provider,
      modelOptions.filter((model) => model.provider === provider).length,
    ]),
  ), [availableProviders, modelOptions])
  const providerOptions = useMemo(() => availableProviders.map((provider) => {
    const representative = modelOptions.find((model) => model.provider === provider)
    return {
      value: provider,
      label: representative ? providerLabel(representative) : provider,
      icon: representative ? (
        <BrandIcon
          slug={representative.providerBrandIconSlug}
          fallbackText={providerLabel(representative)}
          fallbackColor={representative.providerBrandColor}
          size="sm"
        />
      ) : undefined,
    }
  }), [availableProviders, modelOptions])
  const filteredModels = useMemo(() => modelOptions.filter((model) => (
    (providers.length === 0 || providers.includes(model.provider))
    && modelMatchesQuery(model, normalizedQuery)
  )), [modelOptions, normalizedQuery, providers])

  const parsedPage = Number.parseInt(pageValue, 10)
  const requestedPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const pageCount = Math.max(1, Math.ceil(filteredModels.length / PAGE_SIZE))
  const page = Math.min(requestedPage, pageCount)
  const showAll = showAllValue === 'true'
  const visibleModels = showAll
    ? filteredModels
    : filteredModels.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

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
        <Button type="button" variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={refreshing ? 'animate-spin motion-reduce:animate-none' : undefined} />
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
        <Button type="button" variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={refreshing ? 'animate-spin motion-reduce:animate-none' : undefined} />
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
    <>
      <ListPageControls
        label="Available model controls"
        className="!flex-row !flex-wrap !items-center border-t-0 pt-0"
        actions={(
          <>
            {modelsLoaded && modelsCachedAt ? (
              <span className="text-bakin-typography-size-meta text-bakin-text-muted">
                Refreshed {formatRelativeTime(modelsCachedAt)}
                {modelsCached ? ' · cached' : ''}
                {modelsStale ? ' · stale' : ''}
              </span>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={refreshing ? 'animate-spin motion-reduce:animate-none' : undefined} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
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
      </ListPageControls>

      <ListPageContent
        label="Available model results"
        busy={refreshing && modelOptions.length > 0}
        state={state}
      >
        <ul className="m-0 flex list-none flex-col gap-bakin-2 p-0" aria-label="Available models">
          {visibleModels.map((model) => (
            <ModelRow
              key={model.id}
              model={model}
              defaultModel={effectiveDefaultModel}
              saving={saving === 'defaults'}
              setAsDefault={setAsDefault}
            />
          ))}
        </ul>
        <Pagination
          ariaLabel="Available model pagination"
          page={page}
          pageSize={PAGE_SIZE}
          showAll={showAll}
          total={filteredModels.length}
          onPageChange={(nextPage) => onPageChange(String(nextPage))}
          onShowAllChange={(nextShowAll) => {
            onShowAllChange(String(nextShowAll))
            onPageChange('1')
          }}
        />
      </ListPageContent>
    </>
  )
}
