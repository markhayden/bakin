'use client'

import { RefreshCw, AlertTriangle } from 'lucide-react'
import { Button, Badge } from "@makinbakin/sdk/ui"
import { BrandIcon } from './brand-icon'
import type { ModelsData } from './use-models-data'

const TIER_STYLES: Record<string, string> = {
  budget: 'bg-green-500/10 text-green-400',
  standard: 'bg-blue-500/10 text-blue-400',
  premium: 'bg-purple-500/10 text-purple-400',
}

// Relative-time formatter — under 1h: minutes, under 24h: hours, else date.
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

export function AvailableModelsTab({ m }: { m: ModelsData }) {
  const {
    runtimeStatus, modelsLoaded, modelsCached, modelsCachedAt, modelsStale,
    availableModels, modelOptions, availableProviders,
    modelsError, refreshing, handleRefresh, setAsDefault,
  } = m

  return (
    <div className="space-y-6">
        {/* Runtime-out-of-sync banner */}
        {runtimeStatus.restartNeeded && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-3.5" />
              <span>
                Runtime config changed since the last runtime restart. Model list may be out of date until you restart.
              </span>
            </div>
            <Button
              size="xs"
              variant="outline"
              disabled={runtimeStatus.restarting}
              onClick={runtimeStatus.restart}
            >
              {runtimeStatus.restarting ? 'Restarting…' : 'Restart runtime'}
            </Button>
          </div>
        )}

        {/* Refresh + cache-age header */}
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {modelsLoaded && modelsCached && modelsCachedAt ? (
              <span>
                Last refreshed: <span className="font-medium text-foreground">{formatRelativeTime(modelsCachedAt)}</span>
                {modelsStale && <span className="ml-2 text-amber-400">(stale — refreshing…)</span>}
              </span>
            ) : modelsLoaded && !modelsCached && availableModels.length > 0 ? (
              <span>Just refreshed</span>
            ) : null}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="ml-1">{refreshing ? 'Refreshing…' : 'Refresh'}</span>
          </Button>
        </div>

        {/* States: loading / error / list */}
        {!modelsLoaded || (refreshing && availableModels.length === 0) ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-12 gap-3 text-sm text-muted-foreground">
            <RefreshCw className="size-5 animate-spin text-foreground/60" />
            <div>Querying runtime adapter — this can take up to 30 seconds on first load.</div>
          </div>
        ) : availableModels.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-6 space-y-3">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <AlertTriangle className="size-4 text-red-400" />
              Could not load models from the runtime.
            </div>
            {modelsError && (
              <div className="font-mono text-xs text-muted-foreground break-all">{modelsError}</div>
            )}
            <Button size="sm" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="ml-1">Retry</span>
            </Button>
          </div>
        ) : (
          availableProviders.map((provider) => {
            const models = modelOptions.filter((m) => m.provider === provider)
            if (models.length === 0) return null
            // Provider-level metadata from the first model (they all share provider fields).
            const providerMeta = models.find((m) => m.providerLabel) ?? models[0]
            const providerLabel = providerMeta.providerLabel ?? provider.replace(/[-_]/g, ' ')
            return (
              <div key={provider}>
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <BrandIcon
                    slug={providerMeta.providerBrandIconSlug}
                    fallbackText={providerLabel}
                    fallbackColor={providerMeta.providerBrandColor}
                    size="sm"
                  />
                  <span>{providerLabel}</span>
                  <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                    {models.length}
                  </span>
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {models.map((m) => (
                    <div
                      key={m.id}
                      className="rounded-xl border border-border bg-card p-4 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <BrandIcon
                            slug={m.brandIconSlug ?? m.providerBrandIconSlug}
                            fallbackText={m.providerLabel ?? m.provider}
                            fallbackColor={m.providerBrandColor}
                            size="sm"
                          />
                          <span className="font-medium truncate">{m.name}</span>
                          {m.contextWindowDisplay && (
                            <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                              {m.contextWindowDisplay}
                            </span>
                          )}
                        </div>
                        <Badge variant="secondary" className={`${TIER_STYLES[m.tier]} shrink-0`}>
                          {m.tier}
                        </Badge>
                      </div>
                      <div className="font-mono text-xs text-muted-foreground truncate">{m.id}</div>
                      {m.description && (
                        <p className="text-xs text-muted-foreground">{m.description}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-1">
                        {m.bestFor && (
                          <Badge variant="outline" className="text-[10px] font-normal">
                            {m.bestFor}
                          </Badge>
                        )}
                        {m.tags && m.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                        ))}
                      </div>
                      <div className="flex items-center justify-between gap-2 pt-1">
                        {m.costRange ? (
                          <span className="text-[10px] text-muted-foreground">{m.costRange}</span>
                        ) : <span />}
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setAsDefault(m.id)}
                        >
                          Set as Default
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })
        )}
    </div>
  )
}
